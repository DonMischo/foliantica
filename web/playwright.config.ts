import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: [
    // Mock FastAPI backend — handles server-side requests (SSR, prefetch)
    // that Playwright's page.route() cannot intercept.
    {
      command: "node e2e/mock-backend.mjs",
      url: "http://127.0.0.1:8000",
      reuseExistingServer: true,
    },
    // Next.js dev server
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
