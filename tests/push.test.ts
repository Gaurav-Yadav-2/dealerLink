import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { b64u, concat, encryptPayload, vapidAuthorization } from "../src/worker/lib/webpush";
import { addProduct, addRetailer, Client, db, placeOrder, registerOwner } from "./helpers";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** Receiver-side decryption written from RFC 8291 §3.4 — what a browser does with the message. */
async function decryptAsBrowser(body: Uint8Array, uaPrivate: CryptoKey, uaPublicRaw: Uint8Array, authSecret: Uint8Array) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey } as any, uaPrivate, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublicRaw, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  expect(padded[padded.length - 1]).toBe(2); // last-record delimiter
  return { rs, text: dec.decode(padded.slice(0, -1)) };
}

/** Imports a P-256 key pair given as base64url raw public key + private scalar (the RFC's format). */
async function importPair(publicB64: string, privateB64: string): Promise<CryptoKeyPair> {
  const pub = b64u.decode(publicB64);
  const jwk = { kty: "EC", crv: "P-256", x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), d: privateB64, ext: true };
  return {
    privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("raw", pub, { name: "ECDH", namedCurve: "P-256" }, true, []),
  };
}

describe("Web Push encryption (RFC 8291)", () => {
  // Example from RFC 8291 Section 5 (Push Message Encryption Example).
  const V = {
    plaintext: "When I grow up, I want to be a watermelon",
    asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
    salt: "DGv6ra1nlYgDCS1FRnbzlw",
    result:
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  };

  it("reproduces the RFC 8291 example byte for byte", async () => {
    const body = await encryptPayload(enc.encode(V.plaintext), V.uaPublic, V.auth, {
      salt: b64u.decode(V.salt),
      localKeys: await importPair(V.asPublic, V.asPrivate),
    });
    expect(b64u.encode(body)).toBe(V.result);
  });

  it("produces messages a browser can decrypt (fresh random keys and salt)", async () => {
    const ua = await importPair(V.uaPublic, V.uaPrivate);
    const message = JSON.stringify({ title: "Order DL1000 is accepted", body: "नमस्ते ₹" });
    const a = await encryptPayload(enc.encode(message), V.uaPublic, V.auth);
    const b = await encryptPayload(enc.encode(message), V.uaPublic, V.auth);
    expect(b64u.encode(a)).not.toBe(b64u.encode(b)); // random salt + ephemeral key every time
    const out = await decryptAsBrowser(a, ua.privateKey, b64u.decode(V.uaPublic), b64u.decode(V.auth));
    expect(out.text).toBe(message);
    expect(out.rs).toBe(4096);
  });

  it("rejects payloads larger than one record", async () => {
    await expect(encryptPayload(new Uint8Array(5000), V.uaPublic, V.auth)).rejects.toThrow(/too large/);
  });
});

describe("VAPID", () => {
  it("signs a JWT for the push service origin that verifies with the public key", async () => {
    const pub = (env as any).VAPID_PUBLIC_KEY as string;
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", pub, (env as any).VAPID_PRIVATE_KEY, "mailto:a@b.test");
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m).toBeTruthy();
    expect(m[4]).toBe(pub);
    const claims = JSON.parse(dec.decode(b64u.decode(m[2])));
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:a@b.test");
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    expect(claims.exp).toBeLessThanOrEqual(Date.now() / 1000 + 24 * 3600); // push services reject > 24h
    const key = await crypto.subtle.importKey("raw", b64u.decode(pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64u.decode(m[3]), enc.encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});

/** A fake browser: its own push keys and a push-service endpoint on an allowed host. */
async function fakeBrowser() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const endpoint = `https://fcm.googleapis.com/fcm/send/test-${crypto.randomUUID()}`;
  return { pair, raw, auth, endpoint, keys: { p256dh: b64u.encode(raw), auth: b64u.encode(auth) } };
}

describe("phone alerts end to end", () => {
  let sent: { url: string; init: RequestInit }[];
  let pushStatus: number;
  beforeEach(() => {
    sent = [];
    pushStatus = 201;
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://fcm.googleapis.com/")) {
        sent.push({ url, init });
        return new Response(null, { status: pushStatus });
      }
      return real(input, init);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("exposes whether alerts are configured and the public key", async () => {
    const res = await new Client().get("/api/push/key");
    expect(res.data).toEqual({ enabled: true, publicKey: (env as any).VAPID_PUBLIC_KEY });
  });

  it("requires sign-in and accepts only real push services", async () => {
    const browser = await fakeBrowser();
    expect((await new Client().post("/api/push/subscribe", { endpoint: browser.endpoint, keys: browser.keys })).status).toBe(401);
    const owner = await registerOwner("PushVal");
    const evil = await owner.client.post("/api/push/subscribe", { endpoint: "https://attacker.example/collect", keys: browser.keys });
    expect(evil.status).toBe(422);
    const http = await owner.client.post("/api/push/subscribe", { endpoint: "http://fcm.googleapis.com/fcm/send/x", keys: browser.keys });
    expect(http.status).toBe(422);
    const badKey = await owner.client.post("/api/push/subscribe", { endpoint: browser.endpoint, keys: { ...browser.keys, p256dh: "abc" } });
    expect(badKey.status).toBe(422);
    expect((await owner.client.post("/api/push/subscribe", { endpoint: browser.endpoint, keys: browser.keys })).status).toBe(201);
  });

  it("sends the retailer an encrypted alert when the wholesaler changes the order status", async () => {
    const owner = await registerOwner("PushFlow");
    const p = await addProduct(owner.client);
    const r = await addRetailer(owner.client);
    const phone = await fakeBrowser();
    expect((await r.client.post("/api/push/subscribe", { endpoint: phone.endpoint, keys: phone.keys })).status).toBe(201);
    expect((await r.client.post("/api/push/status", { endpoint: phone.endpoint })).data.subscribed).toBe(true);

    const order = (await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data;
    sent = []; // placing the order alerts the wholesaler, not this retailer
    expect((await owner.client.post(`/api/biz/orders/${order.id}/status`, { status: "accepted", note: "Packing today" })).status).toBe(200);
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const req = sent[0];
    expect(req.url).toBe(phone.endpoint);
    const headers = new Headers(req.init.headers);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(headers.get("ttl")).toBe("86400");
    expect(headers.get("authorization")).toMatch(/^vapid t=.+, k=/);
    const body = new Uint8Array(req.init.body as ArrayBuffer);
    const { text } = await decryptAsBrowser(body, phone.pair.privateKey, phone.raw, phone.auth);
    expect(JSON.parse(text)).toEqual({ title: `Order ${order.orderNumber} is accepted`, body: "Packing today", url: `/retailer/orders/${order.id}`, tag: `/retailer/orders/${order.id}` });

    // each notification is pushed exactly once
    const row = await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE link = ? AND pushed_at IS NULL").bind(`/retailer/orders/${order.id}`).first<any>();
    expect(row.n).toBe(0);
  });

  it("alerts the wholesaler about new orders, and never alerts other users", async () => {
    const owner = await registerOwner("PushOwner");
    const other = await registerOwner("PushOther");
    const p = await addProduct(owner.client);
    const r = await addRetailer(owner.client);
    const ownerPhone = await fakeBrowser();
    const otherPhone = await fakeBrowser();
    await owner.client.post("/api/push/subscribe", { endpoint: ownerPhone.endpoint, keys: ownerPhone.keys });
    await other.client.post("/api/push/subscribe", { endpoint: otherPhone.endpoint, keys: otherPhone.keys });
    sent = [];
    const order = (await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data;
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent.map((s) => s.url)).toEqual([ownerPhone.endpoint]);
    const { text } = await decryptAsBrowser(new Uint8Array(sent[0].init.body as ArrayBuffer), ownerPhone.pair.privateKey, ownerPhone.raw, ownerPhone.auth);
    expect(JSON.parse(text).title).toBe(`New order ${order.orderNumber}`);
  });

  it("removes subscriptions the push service reports as gone, and supports turning alerts off", async () => {
    const owner = await registerOwner("PushGone");
    const p = await addProduct(owner.client);
    const r = await addRetailer(owner.client);
    const phone = await fakeBrowser();
    await r.client.post("/api/push/subscribe", { endpoint: phone.endpoint, keys: phone.keys });
    const order = (await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data;
    pushStatus = 410;
    await owner.client.post(`/api/biz/orders/${order.id}/status`, { status: "accepted" });
    await vi.waitFor(async () => {
      const row = await db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?").bind(phone.endpoint).first<any>();
      expect(row.n).toBe(0);
    });

    pushStatus = 201;
    await r.client.post("/api/push/subscribe", { endpoint: phone.endpoint, keys: phone.keys });
    expect((await r.client.post("/api/push/unsubscribe", { endpoint: phone.endpoint })).status).toBe(200);
    expect((await r.client.post("/api/push/status", { endpoint: phone.endpoint })).data.subscribed).toBe(false);
    sent = [];
    await owner.client.post(`/api/biz/orders/${order.id}/status`, { status: "processing" });
    await new Promise((res) => setTimeout(res, 200));
    expect(sent).toHaveLength(0);
  });

  it("does not alert a deactivated retailer", async () => {
    const owner = await registerOwner("PushInactive");
    const p = await addProduct(owner.client);
    const r = await addRetailer(owner.client);
    const phone = await fakeBrowser();
    await r.client.post("/api/push/subscribe", { endpoint: phone.endpoint, keys: phone.keys });
    const order = (await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data;
    await owner.client.patch(`/api/biz/retailers/${r.id}`, { status: "inactive" });
    sent = [];
    await owner.client.post(`/api/biz/orders/${order.id}/status`, { status: "accepted" });
    await new Promise((res) => setTimeout(res, 200));
    expect(sent).toHaveLength(0);
  });

  it("a browser used by two accounts alerts only the account that turned alerts on last", async () => {
    const owner = await registerOwner("PushShared");
    const r = await addRetailer(owner.client);
    const browser = await fakeBrowser();
    await owner.client.post("/api/push/subscribe", { endpoint: browser.endpoint, keys: browser.keys });
    await r.client.post("/api/push/subscribe", { endpoint: browser.endpoint, keys: browser.keys });
    expect((await owner.client.post("/api/push/status", { endpoint: browser.endpoint })).data.subscribed).toBe(false);
    expect((await r.client.post("/api/push/status", { endpoint: browser.endpoint })).data.subscribed).toBe(true);
  });

  it("sends a test alert to the user's own devices", async () => {
    const owner = await registerOwner("PushTest");
    expect((await owner.client.post("/api/push/test")).status).toBe(409);
    const phone = await fakeBrowser();
    await owner.client.post("/api/push/subscribe", { endpoint: phone.endpoint, keys: phone.keys });
    sent = [];
    const res = await owner.client.post("/api/push/test");
    expect(res.data.sent).toBe(1);
    const { text } = await decryptAsBrowser(new Uint8Array(sent[0].init.body as ArrayBuffer), phone.pair.privateKey, phone.raw, phone.auth);
    expect(JSON.parse(text)).toMatchObject({ title: "DealerLink alerts are on", url: "/dashboard" });
  });
});
