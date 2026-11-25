import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/env';

/**
 * End-to-end tests against the real API and PostgreSQL — no mocks (docs/web-testing-strategy.md).
 * The database is reset and seeded every run; tests run one at a time because they share it.
 * The app under test is the production build behind the production security headers.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${E2E.webPort}`,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'node e2e/mail-sink.mjs',
      port: E2E.smtpPort,
      reuseExistingServer: false,
      env: { SMTP_PORT: String(E2E.smtpPort) },
    },
    {
      command: 'node e2e/prepare-db.mjs && cd ../backend && npx nest build && node dist/main.js',
      url: `http://localhost:${E2E.apiPort}/api/v1/health/ready`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'development',
        PORT: String(E2E.apiPort),
        DATABASE_URL: E2E.appUrl,
        APP_BASE_URL: `http://localhost:${E2E.webPort}`,
        ACCESS_TOKEN_TTL_SECONDS: String(E2E.accessTokenSeconds),
        RATE_LIMIT_PER_MINUTE: '100000',
        AUTH_RATE_LIMIT_PER_15_MIN: '100000',
        LOG_LEVEL: 'warn',
        // Test-only SMTP sink (e2e/mail-sink.mjs): emails are stored as files for the tests to read.
        MAIL_SMTP_URL: `smtp://127.0.0.1:${E2E.smtpPort}`,
      },
    },
    {
      // The production build, served with deploy/Caddyfile's headers (CSP included) — what ships.
      command: 'npx ng build --configuration production && node e2e/serve-dist.mjs',
      url: `http://localhost:${E2E.webPort}`,
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      env: { PORT: String(E2E.webPort), API_PORT: String(E2E.apiPort) },
    },
  ],
});
