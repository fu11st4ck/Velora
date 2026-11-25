import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { E2E } from './env';
import { aed, api, apiLogin, createCustomer, createInvoice, createProduct, createUser, emailTo, navigateInApp, signIn } from './support';

const axe = async (page: import('@playwright/test').Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

test.describe('reports', () => {
  test('3/report: the owner sees the server figures for the period, exports CSV; axe passes', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const product = await createProduct(token, { openingQuantity: 3 });
    const customer = await createCustomer(token);
    await createInvoice(token, product.id, customer.id, { payment: { amountMinor: 136500, method: 'CASH' } });

    await page.goto('/sign-in');
    await signIn(page, E2E.owner);
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await page.getByTestId('range-today').click();
    await expect(page).toHaveURL(/range=today/);
    // The page works out "today" in the business time zone; ask the API for the period it shows.
    await expect(page.getByTestId('report-net')).toBeVisible();
    const shown = await api<{ data: { netSalesMinor: number; invoicedMinor: number } }>(token, 'GET', `/reports/sales-summary?${await periodOf(page)}`);
    await expect(page.getByTestId('report-net')).toHaveText(aed(shown.body.data.netSalesMinor));
    await expect(page.getByTestId('report-invoiced')).toHaveText(aed(shown.body.data.invoicedMinor));
    await expect(page.getByTestId('report-profit')).toBeVisible();
    await expect(page.getByTestId('status-bar')).toBeVisible();
    await expect(page.getByTestId('report-people')).toBeVisible();
    await expect(page.getByTestId('report-stock-value')).toBeVisible();

    await page.getByTestId('export-menu').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-sales').click()]);
    expect(download.suggestedFilename()).toMatch(/^velora-sales-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv.split('\n')[0]).toMatch(/^\uFEFF?Invoice,Date,Customer/);

    await page.getByTestId('range-custom').click();
    await page.getByTestId('range-from').fill('2025-01-01');
    await page.getByTestId('range-from').dispatchEvent('change');
    await page.getByTestId('range-to').fill('2026-11-30');
    await page.getByTestId('range-to').dispatchEvent('change');
    await expect(page.getByText('Choose at most 366 days.')).toBeVisible();
    await page.getByTestId('range-month').click();
    await expect(page.getByTestId('report-net')).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test('a salesperson sees only their own sales and no cost, team, stock or export', async ({ page }) => {
    await page.goto('/sign-in');
    await signIn(page, E2E.sales);
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page.getByTestId('report-net')).toBeVisible();
    await expect(page.getByText('· your sales')).toBeVisible();
    await expect(page.getByTestId('report-profit')).toHaveCount(0);
    await expect(page.getByTestId('report-people')).toHaveCount(0);
    await expect(page.getByTestId('export-menu')).toHaveCount(0);
    const token = await apiLogin(E2E.sales);
    const res = await fetch(`http://localhost:${E2E.apiPort}/api/v1/reports/sales-summary?from=2026-11-01&to=2026-11-30`, { headers: { authorization: `Bearer ${token}`, accept: 'text/csv' } });
    expect(res.status).toBe(403);
    const summary = await api<{ data: Record<string, unknown> }>(token, 'GET', '/reports/sales-summary?from=2026-11-01&to=2026-11-30');
    expect(summary.body.data).not.toHaveProperty('grossProfitMinor');
    expect((await api(token, 'GET', '/reports/inventory-valuation')).status).toBe(403);
  });
});

/** The period the reports page is showing, as query parameters for the API. */
async function periodOf(page: import('@playwright/test').Page): Promise<string> {
  const subtitle = (await page.locator('app-page-header p.t-muted').first().textContent()) ?? '';
  // The page header shows "25 Nov 2026" or "1 Nov 2026 – 25 Nov 2026"; convert with the browser's own parser.
  const parts = subtitle.split(' · ')[0]!.split(' – ').map((d) => new Date(`${d} UTC`).toISOString().slice(0, 10));
  return `from=${parts[0]}&to=${parts[1] ?? parts[0]}`;
}

test.describe('settings', () => {
  test('the owner changes a sales rule (only that field is sent) and the sale uses it; a manager can only read', async ({ page }) => {
    const owner = await apiLogin(E2E.owner);
    try {
      await page.goto('/sign-in');
      await signIn(page, E2E.owner);
      await page.getByRole('link', { name: 'Business settings', exact: true }).click();
      await expect(page.getByTestId('regional-locked')).toBeVisible();
      const sent = page.waitForRequest((r) => r.url().endsWith('/api/v1/organization') && r.method() === 'PATCH');
      await page.getByTestId('org-credit-days').fill('45');
      await page.getByTestId('settings-save').click();
      expect((await sent).postDataJSON()).toEqual({ defaultCreditDays: 45 });
      await expect(page.getByText('Business settings saved.')).toBeVisible();
      // The session profile was reloaded: a new sale offers 45 credit days.
      const product = await createProduct(owner, { openingQuantity: 2 });
      const customer = await createCustomer(owner);
      await page.getByRole('link', { name: 'New sale', exact: true }).click();
      await page.getByTestId('sale-search').fill(product.name);
      await expect(page.getByTestId('sale-result')).toHaveCount(1);
      await page.getByTestId('sale-add').click();
      await page.getByTestId('editor-accept').click();
      await page.getByTestId('choose-customer').click();
      await page.getByTestId('picker-search').fill(customer.name!);
      await expect(page.getByTestId('picker-result')).toHaveCount(1);
      await page.getByTestId('picker-result').click();
      await page.getByTestId('take-payment').click();
      await page.getByTestId('pay-none').click();
      await expect(page.getByTestId('pay-days')).toHaveValue('45');
      await page.getByTestId('payment-back').click();
      await page.getByTestId('clear-sale').click();
      await page.getByTestId('confirm').click();
    } finally {
      expect((await api(owner, 'PATCH', '/organization', { defaultCreditDays: 30 })).status).toBe(200);
    }

    const manager = await apiLogin(E2E.manager);
    expect((await api(manager, 'PATCH', '/organization', { defaultCreditDays: 10 })).status).toBe(403);
  });

  test('a manager sees settings read-only', async ({ page }) => {
    await page.goto('/sign-in');
    await signIn(page, E2E.manager);
    await page.getByRole('link', { name: 'Business settings', exact: true }).click();
    await expect(page.getByText('Only the owner can change these settings.')).toBeVisible();
    await expect(page.getByTestId('org-name')).toBeDisabled();
    await expect(page.getByTestId('settings-save')).toHaveCount(0);
    await page.getByRole('link', { name: 'Team', exact: true }).click();
    await expect(page.getByTestId('team-row').first()).toBeVisible();
    await expect(page.getByTestId('invite-submit')).toHaveCount(0);
  });

  test('tax rates: add, make default, stop using — exactly one default', async ({ page }) => {
    const owner = await apiLogin(E2E.owner);
    const name = `Test rate ${Date.now() % 100000}`;
    const before = (await api<{ data: { id: string; isDefault: boolean }[] }>(owner, 'GET', '/tax-rates')).body.data.find((r) => r.isDefault)!;
    try {
      await page.goto('/sign-in');
      await signIn(page, E2E.owner);
      await page.getByRole('link', { name: 'Tax rates', exact: true }).click();
      await page.getByTestId('tax-name').fill(name);
      await page.getByTestId('tax-rate').fill('12.5');
      await page.getByTestId('tax-add').click();
      const row = page.getByTestId('tax-row').filter({ hasText: name });
      await expect(row).toContainText('12.5%');
      await row.getByTestId('tax-make-default').click();
      await expect(row).toContainText('Default');
      await expect(page.locator('[data-testid="tax-row"] app-status-pill').filter({ hasText: /^\s*Default\s*$/ })).toHaveCount(1);
    } finally {
      expect((await api(owner, 'PATCH', `/tax-rates/${before.id}`, { isDefault: true })).status).toBe(200);
    }
    await page.reload();
    const row = page.getByTestId('tax-row').filter({ hasText: name });
    await row.getByTestId('tax-stop').click();
    await page.getByTestId('confirm').click();
    await expect(row).toContainText('Not in use');
  });

  test('18: an invited person follows the emailed https link, chooses a password and signs in', async ({ page, browser }) => {
    const email = `invitee-${Date.now()}@velora.example`;
    await page.goto('/sign-in');
    await signIn(page, E2E.owner);
    await page.getByRole('link', { name: 'Team', exact: true }).click();
    await page.getByTestId('invite-name').fill('Rania Invitee');
    await page.getByTestId('invite-email').fill(email);
    await page.getByTestId('invite-submit').click();
    await expect(page.getByTestId('invite-result')).toHaveText(`Invitation sent to ${email}.`);
    await expect(page.getByTestId('team-row').filter({ hasText: email })).toContainText('Invited');

    const mail = await emailTo(email);
    const link = /(http:\/\/localhost:\d+\/reset-password\?token=[A-Za-z0-9_-]+)/.exec(mail)?.[1];
    expect(link, 'invitation email contains a reset link to the web app').toBeTruthy();
    const other = await browser.newContext();
    const invitee = await other.newPage();
    await invitee.goto(link!);
    await invitee.getByTestId('new-password').fill('pearl-harbour-sunset-7');
    await invitee.getByTestId('confirm-password').fill('pearl-harbour-sunset-7');
    await invitee.getByTestId('save-password').click();
    await expect(invitee.getByTestId('reset-done')).toBeVisible();
    await invitee.goto('/sign-in');
    await signIn(invitee, email, 'pearl-harbour-sunset-7');
    await expect(invitee.getByTestId('account-menu')).toContainText('Sales');
    await other.close();
  });

  test('removing access signs the person out at once; restoring lets them back in', async ({ page }) => {
    const person = await createUser('SALES');
    const token = await apiLogin(person.email, person.password);
    expect((await api(token, 'GET', '/auth/me')).status).toBe(200);
    await page.goto('/sign-in');
    await signIn(page, E2E.owner);
    await page.getByRole('link', { name: 'Team', exact: true }).click();
    const row = page.getByTestId('team-row').filter({ hasText: person.email });
    await row.getByTestId('member-remove').click();
    await page.getByTestId('confirm').click();
    await expect(row).toContainText('No access');
    expect((await api(token, 'GET', '/auth/me')).status).toBe(401);
    await row.getByTestId('member-restore').click();
    await expect(row).toContainText('Active');
    expect((await api(await apiLogin(person.email, person.password), 'GET', '/auth/me')).status).toBe(200);
    expect(await axe(page)).toEqual([]);
  });
});

test.describe('account', () => {
  test('changing the password signs other devices out but keeps this one; devices can be signed out one by one', async ({ page }) => {
    const person = await createUser('SALES');
    const phone = await apiLogin(person.email, person.password);
    const tablet = await apiLogin(person.email, person.password);
    await page.goto('/sign-in');
    await signIn(page, person.email, person.password);

    await page.getByTestId('account-menu').click();
    await page.getByTestId('menu-devices').click();
    await expect(page.getByTestId('device-row')).toHaveCount(3);
    await expect(page.getByTestId('device-row').first()).toContainText('This device');
    await page.getByTestId('device-row').nth(1).getByTestId('device-sign-out').click();
    await page.getByTestId('confirm').click();
    await expect(page.getByTestId('device-row')).toHaveCount(2);
    const statuses = [(await api(phone, 'GET', '/auth/me')).status, (await api(tablet, 'GET', '/auth/me')).status].sort();
    expect(statuses).toEqual([200, 401]);

    await page.getByTestId('account-menu').click();
    await page.getByTestId('menu-password').click();
    await page.getByTestId('current-password').fill('wrong-password-123');
    await page.getByTestId('new-password').fill('silver-lining-orchid-42');
    await page.getByTestId('confirm-password').fill('silver-lining-orchid-42');
    await page.getByTestId('password-save').click();
    await expect(page.getByTestId('password-error')).toHaveText('The current password is incorrect.');
    await page.getByTestId('current-password').fill(person.password);
    await page.getByTestId('password-save').click();
    await expect(page.getByText('Password changed. Your other devices were signed out.')).toBeVisible();
    expect((await api(phone, 'GET', '/auth/me')).status).toBe(401);
    expect((await api(tablet, 'GET', '/auth/me')).status).toBe(401);
    await navigateInApp(page, '/account/devices');
    await expect(page.getByTestId('device-row')).toHaveCount(1); // this browser stayed signed in
    await apiLogin(person.email, 'silver-lining-orchid-42');
  });
});

test.describe('global search', () => {
  test('Ctrl+K finds products, customers and documents and opens one with the keyboard', async ({ page }) => {
    const token = await apiLogin(E2E.owner);
    const tag = `Zircon${Date.now() % 100000}`;
    const product = await createProduct(token, { name: `${tag} Pendant`, openingQuantity: 2 });
    const customer = await createCustomer(token, { name: `${tag} Client` });
    await createInvoice(token, product.id, customer.id);
    await page.goto('/sign-in');
    await signIn(page, E2E.manager);
    await expect(page.getByTestId('kpi-0')).toBeVisible(); // the start-up navigation has finished
    await page.keyboard.press('Control+k');
    await page.getByTestId('global-search-input').fill(tag);
    await expect(page.getByTestId('global-search-hit')).toHaveCount(3);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Products', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Customers', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Documents', { exact: true })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: `${tag} Client` })).toBeVisible();
  });
});
