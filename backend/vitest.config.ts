import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false, // all files share one Postgres database
    hookTimeout: 30000,
  },
});
