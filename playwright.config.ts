import { defineConfig } from "@playwright/test";

const useInstalledChrome = process.env.PLAYWRIGHT_CHANNEL === "chrome";
const localWebServers = [
  {
    command: "node tests/support/mock-ollama.mjs",
    url: "http://127.0.0.1:12436/health",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
  {
    command: "npx next dev --webpack --hostname=127.0.0.1 --port=33213",
    url: "http://127.0.0.1:33213",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      QA_PLAYWRIGHT_BUILD_DIR: ".next-qa",
      OLLAMA_URL: "http://127.0.0.1:12436",
      OLLAMA_MODEL: "qa-mock",
      OLLAMA_TIMEOUT_MS: "3000",
    },
  },
];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "./evidence/playwright",
  timeout: 30_000,
  use: {
    ...(useInstalledChrome ? { channel: "chrome" } : {}),
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:33213",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Unit-style proxy/schema tests do not need the local app or mock provider.
  ...(process.env.QA_SKIP_WEB_SERVER === "1"
    ? {}
    : { webServer: localWebServers }),
});
