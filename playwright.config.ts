import { defineConfig } from "@playwright/test";
export default defineConfig({
  workers: 1,
  testDir: "./tests/e2e",
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
  },
  reporter: "list",
});
