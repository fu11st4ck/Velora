import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E } from './env';
import { api, apiLogin, createProduct, navigateInApp, signIn, dialogReady } from './support';

/** Opens the products page through the sidebar, as a person would. */
async function openProducts(page: Page) {
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible();
}

async function search(page: Page, text: string) {
  await page.getByTestId('product-search').fill(text);
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(text).replace(/%20/g, '(\\+|%20)')}`));
}

test.describe('inventory (manager)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in');
    await signIn(page, E2E.manager);
  });

  test('4: creates a product with opening stock; prices come from the server', async ({ page }) => {
    const name = `Pearl Drop Earrings ${Date.now()}`;
    await openProducts(page);
    await page.getByTestId('new-product').click();
    await page.getByTestId('product-name').fill(name);
    await page.getByTestId('product-cost').fill('1,000.00');
    await page.getByTestId('product-default-markup').fill('30');
    await page.getByTestId('product-min-markup').fill('15');
    await page.getByTestId('product-opening').fill('5');
    await page.getByTestId('product-reorder').fill('2');
    await expect(page.getByTestId('preview-list')).toHaveText('AED 1,300.00');
    await page.getByTestId('product-save').click();

    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByTestId('list-price')).toHaveText('AED 1,300.00');
    await expect(page.getByTestId('floor-price')).toHaveText('AED 1,150.00');
    await expect(page.getByTestId('ceiling-price')).toHaveText('AED 1,600.00'); // organization maximum 60%
    await expect(page.getByTestId('on-hand')).toHaveText('5');
    await expect(page.getByTestId('movement').first()).toContainText('Opening stock');

    await openProducts(page);
    await search(page, name);
    await expect(page.getByTestId('product-row')).toHaveCount(1);
    await expect(page.getByTestId('product-row')).toContainText('AED 1,300.00');
  });

  test('5: edits a product; a concurrent edit elsewhere is reported and reloaded', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token);
    await navigateInApp(page, `/inventory/${product.id}/edit`);
    await expect(page.getByTestId('product-name')).toHaveValue(product.name);

    // Someone else saves first.
    const other = await api(token, 'PATCH', `/products/${product.id}`, { version: product.version, name: `${product.name} (owner)` });
    expect(other.status).toBe(200);

    await page.getByTestId('product-name').fill(`${product.name} (manager)`);
    await page.getByTestId('product-save').click();
    await expect(page.getByTestId('version-conflict')).toBeVisible();
    await expect(page.getByTestId('product-save')).toBeDisabled();
    await page.getByTestId('conflict-reload').click();
    await expect(page.getByTestId('product-name')).toHaveValue(`${product.name} (owner)`);

    await page.getByTestId('product-name').fill(`${product.name} (manager)`);
    await page.getByTestId('product-save').click();
    await expect(page.getByRole('heading', { level: 1, name: `${product.name} (manager)` })).toBeVisible();
  });

  test('6: receives and adjusts stock; history shows it; cannot remove more than on hand', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 10 });
    await navigateInApp(page, `/inventory/${product.id}`);
    await expect(page.getByTestId('on-hand')).toHaveText('10');

    await page.getByTestId('detail-receive').click();
    await dialogReady(page);
    await page.getByTestId('receive-quantity').fill('4');
    await page.getByTestId('receive-cost').fill('1,200.00');
    await page.getByTestId('receive-submit').click();
    await expect(page.getByText('Received 4. 14 on hand.')).toBeVisible();
    await expect(page.getByTestId('on-hand')).toHaveText('14');

    await page.getByTestId('detail-adjust').click();
    await dialogReady(page);
    await page.getByTestId('adjust-out').click();
    await page.getByTestId('adjust-quantity').fill('15');
    await page.getByTestId('adjust-reason').fill('Damaged clasp');
    await page.getByTestId('adjust-submit').click();
    await expect(page.getByText('Only 14 on hand.')).toBeVisible();
    await page.getByTestId('adjust-quantity').fill('2');
    await page.getByTestId('adjust-submit').click();
    await expect(page.getByTestId('on-hand')).toHaveText('12');
    await expect(page.getByTestId('movement').first()).toContainText('Adjustment out');
    await expect(page.getByTestId('movement').first()).toContainText('Damaged clasp');

    // The server refuses it too, whatever the screen allows.
    const forced = await api<{ error: { code: string } }>(token, 'POST', '/inventory/adjustments', { productId: product.id, quantityDelta: -13, reason: 'Forced' });
    expect(forced.status).toBe(409);
    expect(forced.body.error.code).toBe('INSUFFICIENT_STOCK');

    await page.getByRole('link', { name: 'View all' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Stock history' })).toBeVisible();
    await expect(page.getByTestId('history-product-selected')).toHaveValue(new RegExp(product.name));
    await expect(page.getByTestId('history-row')).toHaveCount(3);
    await expect(page.getByTestId('history-row').first()).toContainText('−2');
  });

  test('7: stock at or below the reorder level shows as low on the dashboard and in the Low filter', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const before = await api<{ data: { stock: { lowCount: number } } }>(token, 'GET', '/dashboard/summary');
    const product = await createProduct(token, { openingQuantity: 10, reorderLevel: 5 });
    await navigateInApp(page, `/inventory/${product.id}`);
    await expect(page.getByTestId('stock-status')).toHaveText('In stock');

    await page.getByTestId('detail-adjust').click();
    await dialogReady(page);
    await page.getByTestId('adjust-out').click();
    await page.getByTestId('adjust-quantity').fill('6');
    await page.getByTestId('adjust-reason').fill('Count correction');
    await page.getByTestId('adjust-submit').click();
    await expect(page.getByTestId('stock-status')).toHaveText('Low stock');

    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    const low = before.body.data.stock.lowCount + 1;
    await expect(page.getByTestId('attention-low')).toHaveText(`${low} ${low === 1 ? 'product is' : 'products are'} low in stock`);
    await page.getByTestId('attention-low').click();
    await expect(page).toHaveURL(/\/inventory\?stock=low/);
    await expect(page.getByTestId('stock-low')).toHaveAttribute('aria-pressed', 'true');
    await search(page, product.name);
    await expect(page.getByTestId('product-row')).toHaveCount(1);
    await expect(page.getByTestId('product-row')).toContainText('Low stock');
  });

  test('archive is refused while stock is on hand, and works at zero', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 1 });
    await navigateInApp(page, `/inventory/${product.id}`);
    await page.getByTestId('detail-archive').click();
    await page.getByTestId('confirm').click();
    await expect(page.getByText('This product still has 1 in stock.', { exact: false })).toBeVisible();

    await page.getByTestId('detail-adjust').click();
    await dialogReady(page);
    await page.getByTestId('adjust-out').click();
    await page.getByTestId('adjust-quantity').fill('1');
    await page.getByTestId('adjust-reason').fill('Sold elsewhere');
    await page.getByTestId('adjust-submit').click();
    await expect(page.getByTestId('on-hand')).toHaveText('0');
    await page.getByTestId('detail-archive').click();
    await page.getByTestId('confirm').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible();
    await search(page, product.name);
    await expect(page.getByText('No products match')).toBeVisible();
    await page.getByTestId('show-archived').click();
    await expect(page.getByTestId('product-row')).toContainText('Archived');
  });

  test('inventory pages pass automated accessibility checks', async ({ page }) => {
    for (const path of ['/inventory', '/inventory/history', '/inventory/new']) {
      await navigateInApp(page, path);
      await expect(page.locator('h1')).toBeVisible();
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
  });
});

test.describe('15: a salesperson', () => {
  test('sees no cost and no management actions, and the API agrees', async ({ page }) => {
    await page.goto('/sign-in');
    await signIn(page, E2E.sales);
    await openProducts(page);
    await expect(page.getByTestId('product-row').first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Cost' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Value at cost' })).toHaveCount(0);
    await expect(page.getByTestId('new-product')).toHaveCount(0);
    await expect(page.getByTestId('product-actions')).toHaveCount(0);

    await page.getByTestId('product-row').first().getByRole('link').click();
    await expect(page.getByTestId('list-price')).toBeVisible();
    await expect(page.getByTestId('cost')).toHaveCount(0);
    await expect(page.getByTestId('detail-adjust')).toHaveCount(0);
    await expect(page.getByTestId('detail-edit')).toHaveCount(0);

    await navigateInApp(page, '/inventory/new');
    await expect(page.getByRole('heading', { name: "You don't have access to this" })).toBeVisible();

    const token = await apiLogin(E2E.sales);
    const list = await api<{ data: Record<string, unknown>[] }>(token, 'GET', '/products?limit=100');
    expect(list.status).toBe(200);
    for (const p of list.body.data) {
      expect(p).not.toHaveProperty('costMinor');
      expect(p).not.toHaveProperty('defaultMarkupBp');
      expect(p).not.toHaveProperty('minMarkupBp');
    }
    const moves = await api<{ data: Record<string, unknown>[] }>(token, 'GET', '/inventory/movements?limit=100');
    for (const m of moves.body.data) expect(m).not.toHaveProperty('unitCostMinor');
    const adjust = await api(token, 'POST', '/inventory/adjustments', { productId: list.body.data[0]!['id'], quantityDelta: 1, reason: 'Not allowed' });
    expect(adjust.status).toBe(403);
    const create = await api(token, 'POST', '/products', { name: 'Not allowed', costMinor: 1, defaultMarkupBp: 0, minMarkupBp: 0, openingQuantity: 0 });
    expect(create.status).toBe(403);
  });
});

test.describe('16: organization data isolation', () => {
  test("another business's products never appear, not even by direct link", async ({ page }) => {
    const otherToken = await apiLogin(E2E.otherOwner, E2E.otherPassword);
    const foreign = await createProduct(otherToken, { name: `Foreign Necklace ${Date.now()}` });

    await page.goto('/sign-in');
    await signIn(page, E2E.manager);
    await openProducts(page);
    await search(page, foreign.name);
    await expect(page.getByText('No products match')).toBeVisible();
    await search(page, foreign.sku);
    await expect(page.getByText('No products match')).toBeVisible();

    await navigateInApp(page, `/inventory/${foreign.id}`);
    await expect(page.getByRole('heading', { name: 'Product not found' })).toBeVisible();
    await navigateInApp(page, `/inventory/${foreign.id}/edit`);
    await expect(page.getByRole('heading', { name: 'Product not found' })).toBeVisible();
    await navigateInApp(page, `/inventory/history?product=${foreign.id}`);
    await expect(page.getByText('No movements match')).toBeVisible();

    const token = await apiLogin(E2E.manager);
    expect((await api(token, 'GET', `/products/${foreign.id}`)).status).toBe(404);
    expect((await api(token, 'PATCH', `/products/${foreign.id}`, { version: foreign.version, name: 'Taken over' })).status).toBe(404);
    expect((await api(token, 'POST', '/inventory/adjustments', { productId: foreign.id, quantityDelta: -1, reason: 'Cross-tenant' })).status).toBe(404);
    const moves = await api<{ data: unknown[] }>(token, 'GET', `/inventory/movements?productId=${foreign.id}`);
    expect(moves.body.data).toEqual([]);
  });
});
