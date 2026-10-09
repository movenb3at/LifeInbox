import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/landing",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: [["list"]],
  outputDir: "test-results/landing",
  use: {
    baseURL: "http://127.0.0.1:4173/LifeInbox/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, channel: process.env.CI ? undefined : "msedge" } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: process.env.CI ? undefined : "msedge" } },
  ],
  webServer: {
    command: "pnpm landing:preview",
    url: "http://127.0.0.1:4173/LifeInbox/",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
