import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

// Tests run inside workerd (the real Workers runtime) against a real local D1 database.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, ALLOW_DEMO_ACCOUNTS: "false", DEV_SHOW_RESET_LINKS: "false", ALLOWED_ORIGINS: "http://trusted.test" },
        },
      }),
    ],
    test: { include: ["tests/**/*.test.ts"], setupFiles: ["./tests/setup.ts"], testTimeout: 30000, hookTimeout: 30000 },
  };
});
