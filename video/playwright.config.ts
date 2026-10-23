import { defineConfig } from "@playwright/test";

// Only for the narrated-video recorder (video/make.mjs runs it). Separate from any test suite.
export default defineConfig({
  testDir: ".",
  testMatch: /record\.spec\.ts/,
  timeout: 20 * 60 * 1000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: "../test-results/video",
  use: {
    viewport: { width: 1920, height: 1080 },
    video: { mode: "on", size: { width: 1920, height: 1080 } },
    actionTimeout: 15000,
    navigationTimeout: 30000,
    headless: false,
    launchOptions: { slowMo: 40 },
  },
});
