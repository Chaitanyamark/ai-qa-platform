import { defineConfig } from "@playwright/test";

const useInstalledChrome = process.env.PLAYWRIGHT_CHANNEL === "chrome";
const appPort = Number(process.env.PLAYWRIGHT_PORT) || 3210;
const mockPort = Number(process.env.MOCK_OLLAMA_PORT) || 11436;
const appUrl = `http://127.0.0.1:${appPort}`;
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
      url: `http://127.0.0.1:${mockPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      env: {
        MOCK_OLLAMA_PORT: String(mockPort),
      },
    },
    {
      command: `${nextCommand} dev --hostname 127.0.0.1 --port ${appPort}`,
      url: appUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        OLLAMA_URL: `http://127.0.0.1:${mockPort}`,
        OLLAMA_MODEL: "qa-mock",
        OLLAMA_TIMEOUT_MS: "3000",
        NEXT_DIST_DIR: ".next-playwright",
      },
    },
  ],
});
