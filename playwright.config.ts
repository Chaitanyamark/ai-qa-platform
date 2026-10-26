import { defineConfig } from "@playwright/test";

const useInstalledChrome = process.env.PLAYWRIGHT_CHANNEL === "chrome";
const appUrl = "http://127.0.0.1:3210";
const nextCommand =
  process.platform === "win32"
    ? ".\\node_modules\\.bin\\next.cmd"
    : "./node_modules/.bin/next";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "./evidence/playwright",
  timeout: 30_000,
  use: {
    ...(useInstalledChrome ? { channel: "chrome" } : {}),
    baseURL: appUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node tests/support/mock-ollama.mjs",
      url: "http://127.0.0.1:11436/health",
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      env: {
        MOCK_OLLAMA_PORT: "11436",
      },
    },
    {
      command: `${nextCommand} dev --hostname 127.0.0.1 --port 3210`,
      url: appUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        OLLAMA_URL: "http://127.0.0.1:11436",
        OLLAMA_MODEL: "qa-mock",
        OLLAMA_TIMEOUT_MS: "3000",
        NEXT_DIST_DIR: ".next-playwright",
      },
    },
  ],
});
