import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E } from './env';
import { aed, api, apiLogin, createCustomer, createProduct, navigateInApp, signIn, sql } from './support';

/** Opens the sale workspace and starts from an empty sale. */
async function openSale(page: Page) {
  await page.getByRole('link', { name: 'New sale', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New sale' })).toBeVisible();
  if (await page.getByTestId('clear-sale').isEnabled()) {
    await page.getByTestId('clear-sale').click();
    await page.getByTestId('confirm').click();
  }
}

async function addProduct(page: Page, name: string, quantity = 1, price?: string) {
  await page.getByTestId('sale-search').fill(name);
  await expect(page.getByTestId('sale-result')).toHaveCount(1);
  await page.getByTestId('sale-result').getByTestId('sale-add').click();
  await page.getByTestId('editor-quantity').fill(String(quantity));
  if (price) await page.getByTestId('editor-price').fill(price);
  await page.getByTestId('editor-accept').click();
  await expect(page.getByTestId('editor-accept')).toHaveCount(0);
}

async function chooseCustomer(page: Page, search: string) {
  await page.getByTestId('choose-customer').click();
  await page.getByTestId('picker-search').fill(search);
  await expect(page.getByTestId('picker-result')).toHaveCount(1);
  await page.getByTestId('picker-result').click();
}

async function invoicesFor(customerId: string): Promise<{ number: string; total_minor: string; paid_minor: string }[]> {
  return sql(`SELECT number, total_minor, paid_minor FROM invoices WHERE customer_id = $1`, [customerId]);
}

test.describe('selling (manager)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in');
    await signIn(page, E2E.manager);
  });

  test('8: a full cash sale issues a paid invoice, takes the stock and shows on the dashboard', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 5 }); // cost 1,000.00, list 1,300.00
    const customer = await createCustomer(token);
    const before = (await api<{ data: { todaySales: { invoicedMinor: number } } }>(token, 'GET', '/dashboard/summary')).body.data.todaySales.invoicedMinor;

    await openSale(page);
    await addProduct(page, product.name, 2);
    await chooseCustomer(page, customer.name!);
    // 2 × 1,300.00 = 2,600.00 + 5% VAT 130.00 = 2,730.00, from the server's preview.
    await expect(page.getByTestId('sale-total')).toHaveText('AED 2,730.00');
    await expect(page.getByTestId('line-total')).toHaveText('AED 2,600.00');
    await page.getByTestId('take-payment').click();
    await expect(page.getByTestId('payment-outcome')).toHaveText('Paid in full.');
    await page.getByTestId('confirm-sale').click();
    await page.getByTestId('confirm').click();

    await expect(page.getByTestId('sale-done')).toBeVisible();
    await expect(page.getByTestId('done-number')).toHaveText(/^INV-\d{4}-\d{5}$/);
    await expect(page.getByTestId('done-status')).toHaveText('Paid');
    await expect(page.getByTestId('done-balance')).toHaveText('AED 0.00');
    expect(await invoicesFor(customer.id)).toEqual([expect.objectContaining({ total_minor: '273000', paid_minor: '273000' })]);

    const stock = await api<{ data: { quantity: number } }>(token, 'GET', `/products/${product.id}`);
    expect(stock.body.data.quantity).toBe(3);
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByTestId('kpi-0')).toContainText(aed(before + 273000));
  });

  test('10: part payment by bank transfer leaves a dated balance', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 5 });
    const customer = await createCustomer(token);
    await openSale(page);
    await addProduct(page, product.name, 1);
    await chooseCustomer(page, customer.name!);
    await expect(page.getByTestId('sale-total')).toHaveText('AED 1,365.00');
    await page.getByTestId('take-payment').click();
    await page.getByTestId('pay-other').click();
    await page.getByTestId('pay-amount').fill('1,000.00');
    await page.getByTestId('method-bank').click();
    await page.getByTestId('pay-reference').fill('TRX-55120');
    await page.getByTestId('pay-days').fill('15');
    await expect(page.getByTestId('payment-outcome')).toHaveText(/^Partially paid — AED 365\.00 due \d{1,2} \w{3} \d{4}\.$/);
    await page.getByTestId('confirm-sale').click();
    await page.getByTestId('confirm').click();
    await expect(page.getByTestId('done-status')).toHaveText('Partially paid');
    await expect(page.getByTestId('done-balance')).toHaveText('AED 365.00');
    await expect(page.getByTestId('done-due')).toBeVisible();
    const [row] = await sql<{ method: string; reference: string; amount_minor: string; credit_days: number }>(
      `SELECT p.method, p.reference, p.amount_minor, i.credit_days FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.customer_id = $1`,
      [customer.id],
    );
    expect(row).toEqual({ method: 'BANK_TRANSFER', reference: 'TRX-55120', amount_minor: '100000', credit_days: 15 });
  });

  test('11: a credit sale records no payment, and more than the total cannot be taken', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 5 });
    const customer = await createCustomer(token);
    await openSale(page);
    await addProduct(page, product.name, 1);
    await chooseCustomer(page, customer.name!);
    await page.getByTestId('take-payment').click();
    await page.getByTestId('pay-other').click();
    await page.getByTestId('pay-amount').fill('1,365.01');
    await expect(page.getByText('At most the total, AED 1,365.00.')).toBeVisible();
    await expect(page.getByTestId('confirm-sale')).toBeDisabled();
    await page.getByTestId('pay-none').click();
    await expect(page.getByTestId('payment-outcome')).toHaveText(/^Unpaid — AED 1,365\.00 due/);
    await page.getByTestId('confirm-sale').click();
    await page.getByTestId('confirm').click();
    await expect(page.getByTestId('done-status')).toHaveText('Unpaid');
    expect(await invoicesFor(customer.id)).toEqual([expect.objectContaining({ paid_minor: '0' })]);

    // The server refuses a payment above the total whatever a client sends.
    const forced = await api<{ error: { code: string } }>(token, 'POST', '/invoices', {
      customerId: customer.id, lines: [{ productId: product.id, quantity: 1, unitPriceMinor: 130000 }], payment: { amountMinor: 999999, method: 'CASH' },
    });
    expect(forced.status).toBe(422);
    expect(forced.body.error.code).toBe('PAYMENT_EXCEEDS_BALANCE');
  });

  test('9: when another sale takes the stock first, nothing is created and the cart says why', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 2 });
    const customer = await createCustomer(token);
    await openSale(page);
    await addProduct(page, product.name, 2);
    await chooseCustomer(page, customer.name!);
    await page.getByTestId('take-payment').click();

    // Another device sells one first.
    const other = await createCustomer(token);
    const sold = await api(token, 'POST', '/invoices', { customerId: other.id, lines: [{ productId: product.id, quantity: 1, unitPriceMinor: 130000 }] });
    expect(sold.status).toBe(201);

    await page.getByTestId('confirm-sale').click();
    await page.getByTestId('confirm').click();
    await expect(page.getByTestId('sale-notice')).toContainText('Only 1 in stock.');
    await expect(page.getByTestId('line-issue')).toHaveText(/Only 1 in stock/);
    await expect(page.getByTestId('cart-line')).toHaveCount(1); // the cart is kept
    await expect(page.getByTestId('take-payment')).toBeDisabled();
    expect(await invoicesFor(customer.id)).toEqual([]);
  });

  test('17: a lost answer is retried with the same key and creates exactly one invoice', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 5 });
    const customer = await createCustomer(token);
    await openSale(page);
    await addProduct(page, product.name, 1);
    await chooseCustomer(page, customer.name!);
    await page.getByTestId('take-payment').click();

    const keys: string[] = [];
    let drop = true;
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    await page.route('**/api/v1/invoices', async (route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '');
      if (drop) {
        drop = false;
        await route.fetch(); // the server receives it and issues the invoice…
        await released;
        await route.abort('connectionreset'); // …but the answer never arrives
      } else {
        await route.continue();
      }
    });
    await page.getByTestId('confirm-sale').click();
    await page.getByTestId('confirm').click();
    // Further clicks while the sale is being sent do nothing (one request per intended sale).
    await expect(page.getByTestId('confirm-sale')).toHaveText('Issuing invoice…');
    await page.getByTestId('confirm-sale').dispatchEvent('click');
    await page.getByTestId('confirm-sale').dispatchEvent('click');
    release();
    await expect(page.getByTestId('payment-error')).toContainText('will not be recorded twice');
    expect(await invoicesFor(customer.id)).toHaveLength(1);
    await page.getByTestId('confirm-sale').click(); // "Retry" — no second confirmation
    await expect(page.getByTestId('sale-done')).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(await invoicesFor(customer.id)).toHaveLength(1);
    const stock = await api<{ data: { quantity: number } }>(token, 'GET', `/products/${product.id}`);
    expect(stock.body.data.quantity).toBe(4);
  });

  test('a quotation is saved without taking stock, then converted into an invoice', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 3 });
    const customer = await createCustomer(token);
    await openSale(page);
    await addProduct(page, product.name, 3, '1,250.00');
    await chooseCustomer(page, customer.name!);
    await page.getByTestId('save-quotation').click();
    await expect(page.getByTestId('done-number')).toHaveText(/^QT-\d{4}-\d{5}$/);
    const number = await page.getByTestId('done-number').textContent();
    expect((await api<{ data: { quantity: number } }>(token, 'GET', `/products/${product.id}`)).body.data.quantity).toBe(3);

    const [q] = await sql<{ id: string }>(`SELECT id FROM quotations WHERE number = $1`, [number]);
    await page.getByTestId('new-sale').click();
    await navigateInApp(page, `/sell?quotation=${q!.id}`);
    await expect(page.getByText(`Converting ${number}`)).toBeVisible();
    await expect(page.getByTestId('sale-customer')).toHaveText(customer.name!);
    await expect(page.getByTestId('line-total')).toHaveText('AED 3,750.00');
    await page.getByTestId('take-payment').click();
    await page.getByTestId('confirm-sale').click();
    await page.getByTestId('confirm').click();
    await expect(page.getByTestId('done-status')).toHaveText('Paid');
    const [converted] = await sql<{ status: string; invoice_id: string | null }>(`SELECT status, (SELECT id FROM invoices WHERE quotation_id = $1) AS invoice_id FROM quotations WHERE id = $1`, [q!.id]);
    expect(converted!.invoice_id).not.toBeNull();
  });

  test('the sale in progress survives a reload', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 3 });
    await openSale(page);
    await addProduct(page, product.name, 1);
    await page.reload();
    await expect(page.getByTestId('cart-line')).toContainText(product.name);
    await page.getByTestId('clear-sale').click();
    await page.getByTestId('confirm').click();
    await expect(page.getByTestId('cart-line')).toHaveCount(0);
  });

  test('a manager may sell below the lowest price with a reason; the sale workspace passes axe', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 3 }); // floor 1,150.00
    const customer = await createCustomer(token);
    await openSale(page);
    await page.getByTestId('sale-search').fill(product.name);
    await expect(page.getByTestId('sale-result')).toHaveCount(1);
    await page.getByTestId('sale-add').click();
    await page.getByTestId('editor-price').fill('1,100.00');
    await expect(page.getByTestId('editor-below')).toBeVisible();
    await page.getByTestId('editor-override').click();
    await page.getByTestId('editor-reason').fill('Loyal customer');
    await page.getByTestId('editor-accept').click();
    await chooseCustomer(page, customer.name!);
    await expect(page.getByTestId('sale-total')).toHaveText('AED 1,155.00');
    await expect(page.getByTestId('line-issue')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

test.describe('selling (salesperson)', () => {
  test('cannot go below the lowest price and sees no cost; the API refuses a forced one', async ({ page }) => {
    const owner = await apiLogin(E2E.owner);
    const product = await createProduct(owner, { openingQuantity: 3 });
    const customer = await createCustomer(owner);
    await page.goto('/sign-in');
    await signIn(page, E2E.sales);
    await openSale(page);
    await page.getByTestId('sale-search').fill(product.name);
    await expect(page.getByTestId('sale-result')).toHaveCount(1);
    await page.getByTestId('sale-add').click();
    await expect(page.getByText('Lowest AED 1,150.00 · Highest AED 1,600.00')).toBeVisible();
    await expect(page.getByText('Profit')).toHaveCount(0);
    await page.getByTestId('editor-price').fill('1,100.00');
    await expect(page.getByTestId('editor-below')).toBeVisible();
    await expect(page.getByTestId('editor-override')).toHaveCount(0);
    await page.getByTestId('editor-accept').click();
    await expect(page.getByTestId('editor-accept')).toBeVisible(); // not accepted

    const token = await apiLogin(E2E.sales);
    const forced = await api<{ error: { code: string } }>(token, 'POST', '/invoices', {
      customerId: customer.id, lines: [{ productId: product.id, quantity: 1, unitPriceMinor: 110000, belowMinimumReason: 'Trying' }],
    });
    expect(forced.status).toBe(422);
    expect(forced.body.error.code).toBe('PRICE_BELOW_MINIMUM');
  });
});

test.describe('customers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in');
    await signIn(page, E2E.manager);
  });

  test('adds a customer; the same mobile number is offered instead of a duplicate', async ({ page }) => {
    const mobile = `05${String(Date.now()).slice(-8)}`;
    await page.getByRole('link', { name: 'Customers', exact: true }).click();
    await page.getByTestId('new-customer').click();
    await page.getByTestId('customer-name').fill('Noura Saleh');
    await page.getByTestId('customer-company').fill('Saleh Jewels');
    await page.getByTestId('customer-mobile').fill(mobile);
    await page.getByTestId('customer-save').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Saleh Jewels · Noura Saleh' })).toBeVisible();
    // Stored in international form.
    await expect(page.getByTestId('customer-mobile-value')).toHaveText(`+971${mobile.slice(1)}`);

    await page.getByRole('link', { name: 'Customers', exact: true }).click();
    await page.getByTestId('new-customer').click();
    await page.getByTestId('customer-name').fill('Someone Else');
    await page.getByTestId('customer-mobile').fill(`+971 ${mobile.slice(1, 3)} ${mobile.slice(3)}`);
    await page.getByTestId('customer-save').click();
    await expect(page.getByTestId('duplicate-mobile')).toContainText('Saleh Jewels · Noura Saleh');
    await page.getByTestId('use-existing').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Saleh Jewels · Noura Saleh' })).toBeVisible();
    await expect(page.getByTestId('customer-new-sale')).toBeVisible();
  });

  test("a salesperson sees only their own documents and figures for a customer", async ({ page }) => {
    const owner = await apiLogin(E2E.owner);
    const product = await createProduct(owner, { openingQuantity: 5 });
    const customer = await createCustomer(owner);
    expect((await api(owner, 'POST', '/invoices', { customerId: customer.id, lines: [{ productId: product.id, quantity: 1, unitPriceMinor: 130000 }] })).status).toBe(201);
    const sales = await apiLogin(E2E.sales);
    expect((await api(sales, 'POST', '/invoices', { customerId: customer.id, lines: [{ productId: product.id, quantity: 2, unitPriceMinor: 130000 }] })).status).toBe(201);

    await navigateInApp(page, `/customers/${customer.id}`);
    await expect(page.getByTestId('document-row')).toHaveCount(2);
    await expect(page.getByTestId('customer-invoiced')).toContainText('AED 4,095.00'); // 1,365.00 + 2,730.00

    await page.getByTestId('account-menu').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await signIn(page, E2E.sales);
    await navigateInApp(page, `/customers/${customer.id}`);
    await expect(page.getByTestId('document-row')).toHaveCount(1);
    await expect(page.getByTestId('customer-invoiced')).toContainText('AED 2,730.00');
    await expect(page.getByText('Figures and documents from your own sales.')).toBeVisible();
    await expect(page.getByTestId('customer-archive')).toHaveCount(0);
  });

  test("16: another business's customers never appear, not even by direct link", async ({ page }) => {
    const other = await apiLogin(E2E.otherOwner, E2E.otherPassword);
    const foreign = await createCustomer(other, { name: `Foreign Client ${Date.now()}` });
    await page.getByRole('link', { name: 'Customers', exact: true }).click();
    await page.getByTestId('customer-search').fill(foreign.name!);
    await expect(page.getByText('No customers match')).toBeVisible();
    await navigateInApp(page, `/customers/${foreign.id}`);
    await expect(page.getByRole('heading', { name: 'Customer not found' })).toBeVisible();
    await navigateInApp(page, `/sell?customer=${foreign.id}`);
    await expect(page.getByTestId('choose-customer')).toBeVisible();
    const token = await apiLogin(E2E.manager);
    expect((await api(token, 'GET', `/customers/${foreign.id}`)).status).toBe(404);
    const product = await createProduct(token, { openingQuantity: 1 });
    expect((await api(token, 'POST', '/invoices', { customerId: foreign.id, lines: [{ productId: product.id, quantity: 1, unitPriceMinor: 130000 }] })).status).toBe(404);
  });
});
