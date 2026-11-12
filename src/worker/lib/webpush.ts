/**
 * Web Push (free browser push notifications) implemented with WebCrypto only — no external service or library.
 *   - Message encryption: RFC 8291 (Message Encryption for Web Push) with RFC 8188 "aes128gcm" content coding
 *   - Server identification: RFC 8292 (VAPID), ES256-signed JWT
 * The browser vendor's push service (Google FCM, Mozilla, Apple, Microsoft) delivers the message; it is free.
 */
import { now } from "./http";
import type { Bindings } from "./http";

const enc = new TextEncoder();

export const b64u = {
  encode(input: ArrayBuffer | Uint8Array): string {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(s: string): Uint8Array {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b + "===".slice((b.length + 3) % 4)), (c) => c.charCodeAt(0));
  },
};

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** HKDF-SHA-256 (extract + expand) producing `length` bytes. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

const RECORD_SIZE = 4096;

/**
 * Encrypts a push message for one browser subscription (RFC 8291 / aes128gcm).
 * `salt` and `localKeys` are injectable only so the RFC test vector can be reproduced; production uses fresh random values.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  authSecret: string,
  opts: { salt?: Uint8Array; localKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = b64u.decode(p256dh);
  const auth = b64u.decode(authSecret);
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error("Push payload too large");
  const local = opts.localKeys ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as any, local.privateKey, 256));

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const ikm = await hkdf(auth, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // single record: plaintext followed by the 0x02 "last record" padding delimiter
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));

  // aes128gcm header: salt(16) | record size (uint32 BE) | key id length (1) | key id (sender public key)
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/** `Authorization` header value identifying this server to the push service (VAPID, RFC 8292). */
export async function vapidAuthorization(endpoint: string, publicKey: string, privateKey: string, subject: string): Promise<string> {
  const pub = b64u.decode(publicKey);
  const jwk = { kty: "EC", crv: "P-256", x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), d: privateKey, ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  // WebCrypto ECDSA signatures are already in the raw r||s form that JWS ES256 requires
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.encode(signature)}, k=${publicKey}`;
}

export type PushMessage = { title: string; body?: string; url?: string; tag?: string };
export type PushTarget = { id: string; endpoint: string; p256dh: string; auth: string };

export const pushConfigured = (env: Bindings) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

/** Sends one push message. Returns the push service's HTTP status (201 = accepted; 404/410 = subscription is gone). */
export async function sendPush(env: Bindings, target: PushTarget, message: PushMessage, subject: string): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), target.p256dh, target.auth);
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
    },
    body,
  });
  return res.status;
}

/** Sends to several subscriptions and removes any the push service says no longer exist. */
export async function sendToTargets(env: Bindings, items: { target: PushTarget; message: PushMessage }[], subject: string): Promise<number> {
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    items.map(async ({ target, message }) => {
      try {
        const status = await sendPush(env, target, message, subject);
        if (status === 404 || status === 410) gone.push(target.id);
        else if (status >= 200 && status < 300) sent++;
        else console.error("Push rejected by push service:", status);
      } catch (e) {
        console.error("Push send failed:", e instanceof Error ? e.message : "unknown");
      }
    }),
  );
  if (gone.length) {
    await env.DB.prepare(`DELETE FROM push_subscriptions WHERE id IN (${gone.map(() => "?").join(",")})`).bind(...gone).run();
  }
  return sent;
}

/** Most pushes one request may send (Workers Free allows 50 outbound requests per invocation). */
const MAX_PUSHES_PER_REQUEST = 20;

/**
 * Pushes every notification created since `sinceIso` that has not been pushed yet, to the recipient's devices.
 * Each notification is claimed atomically (pushed_at), so concurrent requests never push the same one twice.
 * Called after every successful change, so any feature that creates an in-app notification also alerts phones.
 */
export async function dispatchPendingPush(env: Bindings, sinceIso: string, origin: string): Promise<void> {
  const db = env.DB;
  const { results: notes } = await db
    .prepare("UPDATE notifications SET pushed_at = ? WHERE pushed_at IS NULL AND created_at >= ? RETURNING id, user_id, title, body, link")
    .bind(now(), sinceIso)
    .all<{ id: string; user_id: string; title: string; body: string | null; link: string | null }>();
  if (!notes.length || !pushConfigured(env)) return;

  const userIds = [...new Set(notes.map((n) => n.user_id))];
  // Only active accounts (and, for retailers, active retailer profiles) receive alerts.
  const { results: subs } = await db
    .prepare(
      `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth
       FROM push_subscriptions s
       JOIN users u ON u.id = s.user_id AND u.status = 'active'
       LEFT JOIN retailer_profiles r ON r.user_id = u.id
       WHERE s.user_id IN (${userIds.map(() => "?").join(",")}) AND (r.id IS NULL OR r.status = 'active')`,
    )
    .bind(...userIds)
    .all<PushTarget & { user_id: string }>();
  if (!subs.length) return;

  const items = notes
    .flatMap((n) =>
      subs
        .filter((s) => s.user_id === n.user_id)
        .map((target) => ({ target, message: { title: n.title, body: n.body ?? "", url: n.link ?? "/", tag: n.link ?? n.id } })),
    )
    .slice(0, MAX_PUSHES_PER_REQUEST);
  await sendToTargets(env, items, env.VAPID_SUBJECT || origin);
}
