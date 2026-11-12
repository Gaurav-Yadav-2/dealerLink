import { webcrypto } from "node:crypto";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

/** A throwaway VAPID key pair so the Web Push code runs in tests exactly as it does in production. */
async function testVapidKeys() {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: raw.toString("base64url"), privateKey: jwk.d! };
}

// Tests run inside workerd (the real Workers runtime) against a real local D1 database.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  const vapid = await testVapidKeys();
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ALLOW_DEMO_ACCOUNTS: "false",
            DEV_SHOW_RESET_LINKS: "false",
            ALLOWED_ORIGINS: "http://trusted.test",
            VAPID_PUBLIC_KEY: vapid.publicKey,
            VAPID_PRIVATE_KEY: vapid.privateKey,
            VAPID_SUBJECT: "mailto:alerts@dealerlink.test",
          },
        },
      }),
    ],
    test: { include: ["tests/**/*.test.ts"], setupFiles: ["./tests/setup.ts"], testTimeout: 30000, hookTimeout: 30000 },
  };
});
