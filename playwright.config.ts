import { defineConfig, devices } from "@playwright/test";

/** End-to-end tests of the SRS section 4 flows on a phone-size screen (and POS/KDS on a tablet). */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /(customer|staff)\.spec\.ts/ },
    { name: "tablet", use: { ...devices["Galaxy Tab S4"], viewport: { width: 1138, height: 712 } }, testMatch: /pos-kitchen\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev", url: "http://localhost:3000/demo", reuseExistingServer: true, timeout: 180_000 },
});
