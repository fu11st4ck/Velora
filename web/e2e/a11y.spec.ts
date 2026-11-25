import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E } from './env';
import { api, apiLogin, createCustomer, createInvoice, createProduct, navigateInApp, signIn, dialogReady } from './support';

/**
 * W6 accessibility audit: every page, as the owner (who sees every section), in light and dark,
 * on a desktop and a phone, checked by axe against WCAG 2.2 AA. A screen-reader pass with real
 * assistive technology is a manual release step (docs/release-checklist.md).
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function violations(page: Page, label: string): Promise<string[]> {
  // Judge the finished state, not a dialog or page mid-transition (opacity changes contrast).
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  let result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  if (result.violations.length > 0) {
    // Material links labels to fields after rendering; a page caught in between is checked again.
    // A real problem is still there a second later and fails the test.
    await page.waitForTimeout(1000);
    result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  }
  return result.violations.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

/** Waits until the page has its heading and no skeletons or spinners. */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('main h1, main h2').first()).toBeVisible();
  await expect(page.locator('app-skeleton')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForLoadState('networkidle');
}

for (const scheme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`every page passes axe — ${scheme}, ${viewport.width}px`, async ({ browser }) => {
      test.setTimeout(240_000);
      const token = await apiLogin(E2E.owner);
      const product = await createProduct(token, { openingQuantity: 4 });
      const customer = await createCustomer(token, { mobile: '+971501234321' });
      const invoice = await createInvoice(token, product.id, customer.id, { payment: { amountMinor: 50000, method: 'CASH' } });
      const quote = (await api<{ data: { id: string } }>(token, 'POST', '/quotations', { customerId: customer.id, lines: [{ productId: product.id, quantity: 1, unitPriceMinor: 130000 }] })).body.data;

      const context = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await context.newPage();
      const found: string[] = [];
      await page.goto('/sign-in');
      found.push(...(await violations(page, '/sign-in')));
      await page.goto('/forgot-password');
      found.push(...(await violations(page, '/forgot-password')));
      await page.goto('/sign-in');
      await signIn(page, E2E.owner);

      const pages = [
        '/dashboard', '/inventory', `/inventory/${product.id}`, '/inventory/new', `/inventory/${product.id}/edit`, '/inventory/history',
        '/sell', '/customers', `/customers/${customer.id}`, '/customers/new', '/documents', `/documents/invoices/${invoice.id}`,
        `/documents/invoices/${invoice.id}/return`, `/documents/quotations/${quote.id}`, '/reports', '/settings/business',
        '/settings/tax-rates', '/settings/team', '/account/password', '/account/devices', '/forbidden', '/no-such-page',
      ];
      for (const path of pages) {
        await navigateInApp(page, path);
        await settled(page);
        found.push(...(await violations(page, path)));
      }
      // Dialogs and overlays.
      await navigateInApp(page, `/documents/invoices/${invoice.id}`);
      await settled(page);
      await page.getByTestId('invoice-pay').click();
      await dialogReady(page);
      await expect(page.getByTestId('payment-amount')).toBeVisible();
      found.push(...(await violations(page, 'record payment dialog')));
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('payment-amount')).toHaveCount(0);
      await page.keyboard.press('Control+k');
      await dialogReady(page);
      await page.getByTestId('global-search-input').fill('E2E');
      await expect(page.getByTestId('global-search-hit').first()).toBeVisible();
      found.push(...(await violations(page, 'global search')));
      await page.keyboard.press('Escape');
      await context.close();
      expect(found).toEqual([]);
    });
  }
}

test('a sale can be made with the keyboard alone', async ({ page }) => {
  const token = await apiLogin(E2E.owner);
  const product = await createProduct(token, { name: `Keyboard Ring ${Date.now() % 100000}`, openingQuantity: 3 });
  const customer = await createCustomer(token, { name: `Keyboard Client ${Date.now() % 100000}` });
  await page.goto('/sign-in');
  await signIn(page, E2E.manager);
  await navigateInApp(page, '/sell');
  await expect(page.getByRole('heading', { level: 1, name: 'New sale' })).toBeVisible();
  await page.locator('body').click({ position: { x: 1, y: 1 } }); // focus the page, not a field

  await page.keyboard.press('/'); // jump to product search
  await expect(page.getByTestId('sale-search')).toBeFocused();
  await page.keyboard.type(product.name);
  await expect(page.getByTestId('sale-result')).toHaveCount(1);
  await page.keyboard.press('Enter'); // opens the price editor, price field focused
  await expect(page.getByTestId('editor-price')).toBeFocused();
  await page.keyboard.press('Enter'); // accept
  await expect(page.getByTestId('cart-line')).toHaveCount(1);

  // Tab to "Choose customer" and open it.
  for (let i = 0; i < 30 && !(await page.getByTestId('choose-customer').evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(page.getByTestId('choose-customer')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('picker-search')).toBeFocused();
  await page.keyboard.type(customer.name!);
  await expect(page.getByTestId('picker-result')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('picker-result')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sale-customer')).toHaveText(customer.name!);

  for (let i = 0; i < 30 && !(await page.getByTestId('take-payment').evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(page.getByTestId('take-payment')).toBeEnabled();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 30 && !(await page.getByTestId('confirm-sale').evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await page.keyboard.press('Enter'); // confirmation dialog
  await expect(page.getByTestId('confirm')).toBeVisible();
  await dialogReady(page);
  for (let i = 0; i < 5 && !(await page.getByTestId('confirm').evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(page.getByTestId('confirm')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/documents\/invoices\//);
  await expect(page.getByTestId('invoice-status')).toHaveText('Paid');
});
