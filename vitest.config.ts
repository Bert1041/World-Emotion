import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/web", "apps/api"],
    // A workspace with zero tests must fail, not pass silently.
    passWithNoTests: false,
  },
});
