import { defineConfig } from '@playwright/test';

/**
 * Post-deploy smoke test against a running server (docs/release-checklist.md). Read-only: it signs
 * in, looks around and signs out; it creates nothing. Usage:
 *   SMOKE_URL=https://app.yourshop.com SMOKE_EMAIL=… SMOKE_PASSWORD=… npm run smoke
 * SMOKE_INSECURE=1 accepts a self-signed certificate (a local Caddy on https://localhost).
 */
export default defineConfig({
  testDir: './smoke',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: process.env['SMOKE_URL'],
    ignoreHTTPSErrors: process.env['SMOKE_INSECURE'] === '1',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
