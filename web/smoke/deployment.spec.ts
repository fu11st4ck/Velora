import { expect, test } from '@playwright/test';

const email = process.env['SMOKE_EMAIL'] ?? '';
const password = process.env['SMOKE_PASSWORD'] ?? '';

test.beforeAll(() => {
  if (!process.env['SMOKE_URL'] || !email || !password) throw new Error('Set SMOKE_URL, SMOKE_EMAIL and SMOKE_PASSWORD.');
});

test('the deployment serves the app over HTTPS with its security headers and caching', async ({ request, baseURL }) => {
  expect(baseURL).toMatch(/^https:\/\//);
  const page = await request.get('/');
  expect(page.status()).toBe(200);
  const h = page.headers();
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['strict-transport-security']).toContain('max-age=');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['cache-control']).toBe('no-cache');
  const script = /src="([^"]+\.js)"/.exec(await page.text())?.[1];
  expect(script, 'index.html references the app bundle').toBeTruthy();
  const bundle = await request.get(`/${script}`);
  expect(bundle.headers()['cache-control']).toContain('immutable');
  const deepLink = await request.get('/documents/invoices/00000000-0000-4000-8000-000000000000');
  expect(deepLink.status()).toBe(200); // the app handles its own routes
  const health = await request.get('/api/v1/health/ready');
  expect(health.status()).toBe(200);
});

test('a person signs in (secure session cookie), sees the dashboard without CSP violations, and signs out', async ({ page, context }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/.test(m.text())) violations.push(m.text());
  });
  await page.goto('/sign-in');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in').click();
  await expect(page.getByTestId('account-menu')).toBeVisible();
  await expect(page.getByTestId('kpi-0')).toBeVisible();

  const cookie = (await context.cookies()).find((c) => c.name === '__Secure-velora_rt');
  expect(cookie, 'refresh cookie set').toBeTruthy();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.secure).toBe(true);
  expect(cookie!.sameSite).toBe('Strict');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toMatch(/eyJ/); // no token in storage

  await page.reload(); // the session survives a reload through the cookie
  await expect(page.getByTestId('account-menu')).toBeVisible();
  for (const name of ['Documents', 'Customers', 'Products']) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.locator('h1')).toHaveText(name);
  }
  await page.getByTestId('account-menu').click();
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect(violations).toEqual([]);
});
