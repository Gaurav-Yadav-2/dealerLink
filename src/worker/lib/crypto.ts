/**
 * Password hashing: PBKDF2-HMAC-SHA256 via WebCrypto with a 16-byte random salt.
 * 100,000 iterations is the maximum the Workers runtime allows for PBKDF2.
 * Stored format: pbkdf2$<iterations>$<salt b64>$<hash b64>
 */
const ITERATIONS = 100_000;
const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** `iterations` can be lowered via PASSWORD_HASH_ITERATIONS if the Workers free-plan CPU limit is hit; it is stored with each hash, so old hashes keep verifying. */
export async function hashPassword(password: string, iterations: number = ITERATIONS): Promise<string> {
  const n = Math.min(ITERATIONS, Math.max(10_000, Math.floor(iterations) || ITERATIONS));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, n);
  return ["pbkdf2", n, b64(salt), b64(hash)].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !saltB64 || !hashB64) return false;
  const expected = unb64(hashB64);
  const actual = await derive(password, unb64(saltB64), Number(iter));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** URL-safe random token with `bytes` bytes of entropy (default 256 bits). */
export function randomToken(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Tokens are stored only as SHA-256 hashes so a database leak does not expose usable tokens. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
