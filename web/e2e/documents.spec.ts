import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { E2E } from './env';
import { api, apiLogin, createCustomer, createInvoice, createProduct, navigateInApp, signIn, sql, dialogReady } from './support';

test.describe('documents (manager)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in');
    await signIn(page, E2E.manager);
  });

  test('10/11: the rest of a balance is recorded later; more than the balance is refused', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 3 });
    const customer = await createCustomer(token);
    // 1,365.00 total, 365.00 paid now by bank transfer.
    const invoice = await createInvoice(token, product.id, customer.id, { payment: { amountMinor: 36500, method: 'BANK_TRANSFER', reference: 'TRX-1' } });
    await navigateInApp(page, `/documents/invoices/${invoice.id}`);
    await expect(page.getByTestId('invoice-status')).toHaveText('Partially paid');
    await expect(page.getByTestId('invoice-balance')).toHaveText('AED 1,000.00');

    await page.getByTestId('invoice-pay').click();
    await dialogReady(page);
    await expect(page.getByTestId('payment-amount')).toHaveValue('1,000.00');
    await page.getByTestId('payment-amount').fill('1,000.01');
    await page.getByTestId('payment-submit').click();
    await expect(page.getByText('At most the balance, AED 1,000.00.')).toBeVisible();
    await page.getByTestId('payment-amount').fill('400.00');
    await expect(page.getByTestId('payment-outcome')).toHaveText('AED 600.00 will remain to be paid.');
    await page.getByTestId('payment-submit').click();
    await expect(page.getByTestId('invoice-balance')).toHaveText('AED 600.00');

    await page.getByTestId('invoice-pay').click();
    await dialogReady(page);
    await expect(page.getByTestId('payment-outcome')).toHaveText('The invoice will be paid in full.');
    await page.getByTestId('payment-submit').click();
    await expect(page.getByTestId('invoice-status')).toHaveText('Paid');
    await expect(page.getByTestId('invoice-pay')).toHaveCount(0);
    await expect(page.getByTestId('invoice-payment')).toHaveCount(3);

    const forced = await api<{ error: { code: string } }>(token, 'POST', `/invoices/${invoice.id}/payments`, { amountMinor: 100, method: 'CASH' });
    expect(forced.status).toBe(422);
    expect(forced.body.error.code).toBe('INVOICE_ALREADY_PAID');
  });

  test('12: the PDF downloads under the invoice number, is a real PDF, and print opens the print dialog', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 3 });
    const customer = await createCustomer(token, { mobile: '+971501112233' });
    const invoice = await createInvoice(token, product.id, customer.id);
    await navigateInApp(page, `/documents/invoices/${invoice.id}`);

    await page.getByTestId('pdf-menu').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pdf-download').click()]);
    expect(download.suggestedFilename()).toBe(`${invoice.number}.pdf`);
    const bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

    await page.getByTestId('pdf-menu').click();
    await page.getByTestId('pdf-view').click();
    await expect(page.getByTestId('pdf-frame')).toHaveAttribute('src', /^blob:/);
    await page.getByRole('button', { name: 'Close' }).click();

    // Print loads the server's PDF into a hidden frame and calls print() on it (the browser's dialog
    // itself cannot be observed in a headless run).
    await page.getByTestId('pdf-menu').click();
    await page.getByTestId('pdf-print').click();
    await expect(page.locator('[data-testid="pdf-print-frame"]')).toHaveAttribute('src', /^blob:/);

    await expect(page.getByTestId('invoice-whatsapp')).toHaveAttribute('href', new RegExp(`^https://wa\\.me/971501112233\\?text=.*${invoice.number}`));
  });

  test('13: cancelling a paid invoice restores stock and records the refund; a salesperson cannot', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 3 });
    const customer = await createCustomer(token);
    const invoice = await createInvoice(token, product.id, customer.id, { payment: { amountMinor: 136500, method: 'CASH' } });
    expect((await api<{ data: { quantity: number } }>(token, 'GET', `/products/${product.id}`)).body.data.quantity).toBe(2);

    // A salesperson: no cancel action, and the API refuses it.
    const sales = await apiLogin(E2E.sales);
    expect((await api(sales, 'POST', `/invoices/${invoice.id}/cancel`, { reason: 'Not allowed', refundMethod: 'CASH' })).status).toBe(403);

    await navigateInApp(page, `/documents/invoices/${invoice.id}`);
    await page.getByTestId('invoice-more').click();
    await page.getByTestId('invoice-cancel').click();
    await dialogReady(page);
    await expect(page.getByText('1 item goes back to stock.')).toBeVisible();
    await expect(page.getByText('AED 1,365.00 received is recorded as refunded.')).toBeVisible();
    await page.getByTestId('cancel-reason').fill('Customer changed their mind');
    await page.getByTestId('cancel-submit').click();
    await expect(page.getByText('Give a reason', { exact: false })).toHaveCount(0);
    await expect(page.getByTestId('cancel-submit')).toBeVisible(); // refund method still missing
    await page.getByTestId('cancel-cash').click();
    await page.getByTestId('cancel-submit').click();
    await expect(page.getByTestId('invoice-status')).toHaveText('Cancelled');
    await expect(page.getByTestId('invoice-cancellation')).toContainText('Customer changed their mind');
    await expect(page.getByTestId('invoice-payment').filter({ hasText: 'Refund' })).toContainText('AED 1,365.00');
    await expect(page.getByTestId('invoice-more')).toHaveCount(0);
    expect((await api<{ data: { quantity: number } }>(token, 'GET', `/products/${product.id}`)).body.data.quantity).toBe(3);
  });

  test('14: returning 1 of 2 unrestocked reduces the balance first and refunds only the excess', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 5 });
    const customer = await createCustomer(token);
    // 2 × 1,300.00 + 5% = 2,730.00; 2,000.00 paid, 730.00 owed. One item is credited 1,365.00 → 730.00 clears the balance, 635.00 refunded.
    const invoice = await createInvoice(token, product.id, customer.id, {
      lines: [{ productId: product.id, quantity: 2, unitPriceMinor: 130000 }],
      payment: { amountMinor: 200000, method: 'CASH' },
    });
    await navigateInApp(page, `/documents/invoices/${invoice.id}`);
    await page.getByTestId('invoice-more').click();
    await page.getByTestId('invoice-return').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Return items' })).toBeVisible();
    await page.getByTestId('return-more').click();
    await page.getByTestId('return-restock').click(); // damaged: not back to stock
    await page.getByTestId('return-reason').fill('Damaged clasp');
    await page.getByTestId('return-submit').click();
    await page.getByTestId('confirm').click();
    await expect(page.getByTestId('return-refund-due')).toContainText('AED 635.00 must be refunded');
    await page.getByTestId('return-refund-cash').click();
    await page.getByTestId('return-submit').click();

    await expect(page).toHaveURL(new RegExp(`/documents/invoices/${invoice.id}$`));
    await expect(page.getByTestId('invoice-return-row')).toContainText(/CN-\d{4}-\d{5}/);
    await expect(page.getByTestId('invoice-return-row')).toContainText('refunded AED 635.00');
    await expect(page.getByTestId('invoice-balance')).toHaveText('AED 0.00');
    // Not restocked: stock stays at 3.
    expect((await api<{ data: { quantity: number } }>(token, 'GET', `/products/${product.id}`)).body.data.quantity).toBe(3);
    // With a return, the invoice can no longer be cancelled.
    await page.getByTestId('invoice-more').click();
    await expect(page.getByTestId('invoice-cancel')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('a refund correction is recorded with its reason', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 3 });
    const customer = await createCustomer(token);
    const invoice = await createInvoice(token, product.id, customer.id, { payment: { amountMinor: 136500, method: 'CASH' } });
    await navigateInApp(page, `/documents/invoices/${invoice.id}`);
    await page.getByTestId('invoice-more').click();
    await page.getByTestId('invoice-refund').click();
    await dialogReady(page);
    await page.getByTestId('refund-amount').fill('2,000.00');
    await page.getByTestId('refund-reason').fill('Charged twice');
    await page.getByTestId('refund-submit').click();
    await expect(page.getByText('At most the amount received, AED 1,365.00.')).toBeVisible();
    await page.getByTestId('refund-amount').fill('65.00');
    await page.getByTestId('refund-submit').click();
    await expect(page.getByTestId('invoice-paid')).toHaveText('AED 1,300.00');
    await expect(page.getByTestId('invoice-balance')).toHaveText('AED 65.00');
    await expect(page.getByTestId('invoice-payment').filter({ hasText: 'Refund' })).toContainText('Charged twice');
  });

  test('documents list: filters by status and search, opens a document; quotations can be cancelled', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 3 });
    const customer = await createCustomer(token, { company: `Filter Co ${Date.now()}` });
    const invoice = await createInvoice(token, product.id, customer.id);
    const quote = await api<{ data: { id: string; number: string } }>(token, 'POST', '/quotations', { customerId: customer.id, lines: [{ productId: product.id, quantity: 1, unitPriceMinor: 130000 }] });

    await page.getByRole('link', { name: 'Documents', exact: true }).click();
    await page.getByTestId('document-search').fill(customer.company!);
    await expect(page.getByTestId('document-row')).toHaveCount(2);
    await page.getByTestId('status-unpaid').click();
    await expect(page).toHaveURL(/type=invoice/);
    await expect(page.getByTestId('document-row')).toHaveCount(1);
    await page.getByTestId('status-paid').click();
    await page.getByTestId('status-unpaid').click();
    await expect(page.getByText('No documents match')).toBeVisible();
    await page.getByTestId('type-quotation').click();
    await expect(page.getByTestId('document-row')).toHaveCount(1);
    await page.getByTestId('document-row').getByRole('link').click();
    await expect(page.locator('#page-title')).toHaveText(quote.body.data.number);
    await page.getByTestId('quotation-cancel').click();
    await page.getByTestId('confirm').click();
    await expect(page.getByTestId('quotation-status')).toHaveText('Cancelled');
    await expect(page.getByTestId('quotation-convert')).toHaveCount(0);

    await navigateInApp(page, `/documents/invoices/${invoice.id}`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    await navigateInApp(page, '/documents');
    await expect(page.getByTestId('document-row').first()).toBeVisible();
    const list = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(list.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

test.describe('documents (salesperson)', () => {
  test("sees only their own documents; another person's invoice is not found; no return, refund or cancel", async ({ page }) => {
    const owner = await apiLogin(E2E.owner);
    const product = await createProduct(owner, { openingQuantity: 5 });
    const customer = await createCustomer(owner, { company: `Own Docs ${Date.now()}` });
    const others = await createInvoice(owner, product.id, customer.id);
    const sales = await apiLogin(E2E.sales);
    const mine = await createInvoice(sales, product.id, customer.id, { payment: { amountMinor: 1000, method: 'CASH' } });

    await page.goto('/sign-in');
    await signIn(page, E2E.sales);
    await page.getByRole('link', { name: 'Documents', exact: true }).click();
    await page.getByTestId('document-search').fill(customer.company!);
    await expect(page.getByTestId('document-row')).toHaveCount(1);
    await expect(page.getByTestId('document-row')).toContainText(mine.number);

    await navigateInApp(page, `/documents/invoices/${others.id}`);
    await expect(page.getByRole('heading', { name: 'Invoice not found' })).toBeVisible();
    await navigateInApp(page, `/documents/invoices/${mine.id}`);
    await expect(page.getByTestId('invoice-pay')).toBeVisible(); // a salesperson records payments
    await expect(page.getByTestId('invoice-more')).toHaveCount(0);
    await expect(page.getByTestId('invoice-profit')).toHaveCount(0);
    await navigateInApp(page, `/documents/invoices/${mine.id}/return`);
    await expect(page.getByRole('heading', { name: "You don't have access to this" })).toBeVisible();
    const [row] = await sql<{ n: string }>(`SELECT count(*)::text AS n FROM invoices WHERE customer_id = $1`, [customer.id]);
    expect(row!.n).toBe('2');
    expect((await api(sales, 'GET', `/invoices/${others.id}`)).status).toBe(404);
    expect((await api(sales, 'POST', `/invoices/${mine.id}/refunds`, { amountMinor: 100, method: 'CASH', note: 'Not allowed' })).status).toBe(403);
  });

  test("16: another business's invoices are not found", async ({ page }) => {
    const other = await apiLogin(E2E.otherOwner, E2E.otherPassword);
    const product = await createProduct(other, { openingQuantity: 2 });
    const customer = await createCustomer(other);
    const foreign = await createInvoice(other, product.id, customer.id);
    await page.goto('/sign-in');
    await signIn(page, E2E.manager);
    await navigateInApp(page, `/documents/invoices/${foreign.id}`);
    await expect(page.getByRole('heading', { name: 'Invoice not found' })).toBeVisible();
    await navigateInApp(page, '/documents');
    // Numbers are per business, so the same number may exist here; the other business's document never does.
    await page.getByTestId('document-search').fill(foreign.number);
    await expect(page).toHaveURL(/q=INV/);
    await expect(page.getByText(/No documents match/).or(page.getByTestId('document-row').first())).toBeVisible();
    await expect(page.locator(`a[href="/documents/invoices/${foreign.id}"]`)).toHaveCount(0);
    const token = await apiLogin(E2E.manager);
    expect((await api(token, 'GET', `/invoices/${foreign.id}`)).status).toBe(404);
    expect((await api(token, 'GET', `/invoices/${foreign.id}/pdf`)).status).toBe(404);
    expect((await api(token, 'POST', `/invoices/${foreign.id}/payments`, { amountMinor: 100, method: 'CASH' })).status).toBe(404);
  });
});
