import { defineConfig } from '@playwright/test';

/**
 * Browser tests. They start their own throwaway API (port 8765, temp database) and the Vite dev server (port 5199),
 * so they never touch your development data.
 *
 *   npm run test:e2e
 *
 * Uses the Microsoft Edge that ships with Windows (no browser download). Set E2E_PYTHON to the Python that has the
 * backend requirements installed, e.g. E2E_PYTHON=../.venv/Scripts/python.exe
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,   // the tests share one database
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    channel: 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/start-backend.mjs',
      url: 'http://127.0.0.1:8765/health',
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5199 --strictPort',
      url: 'http://127.0.0.1:5199',
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_URL: 'http://127.0.0.1:8765' },
    },
  ],
});
