import { expect, test } from '@playwright/test';
import { E2E } from './env';
import { signIn } from './support';

/**
 * All end-to-end tests run against the production build served with deploy/Caddyfile's headers
 * (e2e/serve-dist.mjs). These two check the build and the Content-Security-Policy themselves.
 */
test('the production build runs under the Content-Security-Policy without a single violation', async ({ page }) => {
  const violations: string[] = [];
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 401/.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on('console', (m) => {
    if (m.text().startsWith('CSP:')) violations.push(m.text());
  });

  const response = await page.goto('/sign-in');
  expect(response!.headers()['content-security-policy']).toContain("script-src 'self'");
  await signIn(page, E2E.manager);
  await expect(page.getByTestId('kpi-0')).toBeVisible();
  await page.getByTestId('account-menu').click();
  await page.getByTestId('theme-dark').click();
  await page.keyboard.press('Escape');
  // Fonts and icons load from the same origin.
  expect(await page.evaluate(() => document.fonts.check('24px "Material Symbols Rounded"') && document.fonts.check('16px Inter'))).toBe(true);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('the design-system page is not part of the production build', async ({ page }) => {
  await signIn(page, E2E.manager);
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
