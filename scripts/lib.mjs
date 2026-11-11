// Shared helpers for the local maintenance scripts (seed / create-admin).
import { webcrypto } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";

const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(buf).toString("base64");

/** Same format as src/worker/lib/crypto.ts: pbkdf2$<iterations>$<salt b64>$<hash b64> */
export async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return `pbkdf2$100000$${b64(salt)}$${b64(bits)}`;
}

/** SQL literal. Scripts build SQL files for `wrangler d1 execute`, so values must be escaped here. */
export const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
export const insert = (table, row) => `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(q).join(", ")});`;

export function runSql(file, sql, { remote = false } = {}) {
  writeFileSync(file, sql);
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", "dealerlink", remote ? "--remote" : "--local", "--file", file, "--yes"], { stdio: "inherit", shell: true });
  } finally {
    rmSync(file, { force: true });
  }
}
