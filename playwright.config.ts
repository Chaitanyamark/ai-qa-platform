import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "./evidence/playwright",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3210",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node tests/support/mock-ollama.mjs",
      url: "http://127.0.0.1:11435/health",
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3210",
      url: "http://127.0.0.1:3210",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        OLLAMA_URL: "http://127.0.0.1:11435",
        OLLAMA_MODEL: "qa-mock",
        OLLAMA_TIMEOUT_MS: "3000",
      },
    },
  ],
});
