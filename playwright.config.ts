import { defineConfig, devices } from '@playwright/test';

const port = 4173;
/**
 * Set E2E_BASE_URL to test an already running deployment (e.g. the nginx
 * container) instead of a local `vite preview` server.
 */
const externalUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: externalUrl ?? `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    // The interface follows the browser language; tests check the Turkish texts.
    locale: 'tr-TR',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 } },
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /responsive\.spec\.ts/,
    },
  ],
  webServer: externalUrl
    ? undefined
    : {
        command: `npm run build && npm run preview -- --port ${port}`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
