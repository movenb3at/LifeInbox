import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testIgnore: "**/landing/**", fullyParallel: false, workers: 1, timeout: 40000,
  reporter: [["list"]], use: { baseURL: "http://localhost:3001", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { channel: "msedge", viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: "msedge" } },
  ],
  webServer: [
    { command: "node e2e/auth-server.mjs", url: "http://127.0.0.1:54329/test/session", reuseExistingServer: false },
    { command: "pnpm --filter @lifeinbox/web exec next dev --port 3001 --hostname 127.0.0.1", url: "http://localhost:3001/login", reuseExistingServer: false, timeout: 120000,
      env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key", APP_URL: "http://localhost:3001", NEXT_TELEMETRY_DISABLED: "1", LIFEINBOX_E2E: "1" } },
  ],
});
