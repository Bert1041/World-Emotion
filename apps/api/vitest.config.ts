import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd against a real local D1 (SQLite) and the real rate-limit bindings
// from wrangler.jsonc: no mocks (docs/design/phase-5-api.md §1).
export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("../../migrations", import.meta.url)),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            DEVICE_HASH_SECRET: "test-device-secret",
            IP_SALT_SECRET: "test-ip-secret",
            // Explicit, so a developer's .dev.vars (SIMULATE=1) cannot leak into the tests.
            SIMULATE: "0",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
