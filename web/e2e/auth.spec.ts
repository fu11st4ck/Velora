import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { E2E } from './env';
import { api, apiLogin, createUser, navigateInApp, resetToken, signIn } from './support';

test.describe('signing in', () => {
  test('signs in, keeps the session across reloads, and never exposes a token to page scripts', async ({ page, context }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in\?returnUrl=%2Fdashboard$/);
    await signIn(page, E2E.manager);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening), Maya/);
    await expect(page.getByTestId('account-menu')).toContainText('Manager');

    const cookie = (await context.cookies()).find((c) => c.name === '__Secure-velora_rt');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/api/v1/auth/web' });
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
    expect(stored).not.toMatch(/eyJ|accessToken|refresh/i);

    await page.reload();
    await expect(page.getByTestId('kpi-0')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('explains a wrong password and keeps the email', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByTestId('email').fill(E2E.manager);
    await page.getByTestId('password').fill('not-the-password');
    await page.getByTestId('sign-in').click();
    await expect(page.getByTestId('sign-in-error')).toHaveText('Email or password is incorrect.');
    await expect(page.getByTestId('email')).toHaveValue(E2E.manager);
    await expect(page.getByTestId('password')).toHaveValue('');
  });

  test('locks the account after five wrong passwords and says for how long', async ({ page }) => {
    const user = await createUser('SALES');
    await page.goto('/sign-in');
    await page.getByTestId('email').fill(user.email);
    const attempt = async (password: string) => {
      await page.getByTestId('password').fill(password);
      await Promise.all([page.waitForResponse((r) => r.url().endsWith('/auth/web/login')), page.getByTestId('sign-in').click()]);
    };
    for (let i = 0; i < 5; i++) {
      await attempt(`wrong-${i}`);
      await expect(page.getByTestId('sign-in-error')).toHaveText('Email or password is incorrect.');
    }
    // Locked now: even the right password is refused until the lock ends.
    await attempt(user.password);
    await expect(page.getByTestId('sign-in-error')).toHaveText(/Too many attempts\. Try again in (14|15) minutes\./);
  });

  test('returns to the page that was asked for after signing in', async ({ page }) => {
    await page.goto('/forbidden');
    await expect(page).toHaveURL(/\/sign-in\?returnUrl=%2Fforbidden$/);
    await signIn(page, E2E.manager);
    await expect(page).toHaveURL(/\/forbidden$/);
  });

  test('a signed-in user opening the sign-in page goes to the dashboard', async ({ page }) => {
    await signIn(page, E2E.manager);
    await page.goto('/sign-in');
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

test.describe('sessions', () => {
  test('signing out ends the session on the server and in every tab', async ({ page, context }) => {
    await signIn(page, E2E.manager);
    const second = await context.newPage();
    await second.goto('/dashboard');
    await expect(second.getByTestId('kpi-0')).toBeVisible();

    await page.getByTestId('account-menu').click();
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByTestId('sign-in-notice')).toHaveText('You have signed out.');
    await expect(second).toHaveURL(/\/sign-in/);
    await second.reload();
    await expect(second).toHaveURL(/\/sign-in/); // the cookie no longer works
  });

  test('a session closed from another device sends the browser back to sign-in, then back to its page', async ({ page }) => {
    await signIn(page, E2E.owner);
    const phone = await apiLogin(E2E.owner);
    const sessions = await api<{ data: { id: string; deviceName: string; isCurrent: boolean }[] }>(phone, 'GET', '/auth/sessions');
    const browser = sessions.body.data.find((s) => !s.isCurrent && s.deviceName.includes(' on '))!;
    expect((await api(phone, 'DELETE', `/auth/sessions/${browser.id}`)).status).toBe(204);

    // The next request from the open page is refused at once (not when its token expires).
    await navigateInApp(page, '/elsewhere');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?returnUrl=%2Fdashboard/);
    await expect(page.getByTestId('sign-in-notice')).toHaveText('Your session ended. Sign in again to continue.');
    await signIn(page, E2E.owner);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('an expired access token is renewed without the user noticing, also with several tabs at once', async ({ page, context }) => {
    test.setTimeout(150_000);
    await signIn(page, E2E.manager);
    const tabs = [page, await context.newPage(), await context.newPage()];
    for (const tab of tabs.slice(1)) {
      await tab.goto('/dashboard');
      await expect(tab.getByTestId('kpi-0')).toBeVisible();
    }
    const refreshes: string[] = [];
    context.on('response', (r) => {
      if (r.url().endsWith('/auth/web/refresh')) refreshes.push(String(r.status()));
    });

    await page.waitForTimeout((E2E.accessTokenSeconds + 3) * 1000);
    // All tabs need a new access token at the same moment. Without the cross-tab lock, the second
    // refresh would reuse a rotated cookie and the server would end the whole session.
    // Each tab moves within the app, so it uses its (now expired) in-memory token.
    for (const tab of tabs) await navigateInApp(tab, '/elsewhere');
    for (const tab of tabs) await expect(tab.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await Promise.all(tabs.map((tab) => tab.getByRole('link', { name: 'Dashboard', exact: true }).click()));
    for (const tab of tabs) {
      await expect(tab.getByTestId('kpi-0')).toBeVisible();
      await expect(tab).toHaveURL(/\/dashboard$/);
    }
    expect(refreshes.length).toBeGreaterThanOrEqual(3);
    expect(refreshes.every((s) => s === '200')).toBe(true);
    // And reloading all tabs at once (each restores from the cookie) still works.
    await Promise.all(tabs.map((tab) => tab.reload()));
    for (const tab of tabs) await expect(tab.getByTestId('kpi-0')).toBeVisible();
  });
});

test.describe('passwords', () => {
  test('forgot password always gives the same answer', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByTestId('email').fill('nobody@velora.example');
    await page.getByTestId('send-link').click();
    await expect(page.getByTestId('forgot-done')).toContainText('If an account exists for nobody@velora.example');
  });

  test('a reset (or invitation) link sets a password that then signs in; the link works once', async ({ page }) => {
    const user = await createUser('SALES');
    const token = await resetToken(user.userId);
    await page.goto(`/reset-password?token=${token}`);
    await page.getByTestId('new-password').fill('password123');
    await page.getByTestId('confirm-password').fill('password123');
    await page.getByTestId('save-password').click();
    await expect(page.getByTestId('reset-error')).toHaveText('That password is too common. Choose something less predictable.');

    await page.getByTestId('new-password').fill('garnet-locket-7731');
    await page.getByTestId('confirm-password').fill('garnet-locket-7731');
    await page.getByTestId('save-password').click();
    await expect(page.getByTestId('reset-done')).toBeVisible();
    await page.getByRole('link', { name: 'Sign in' }).click();
    await signIn(page, user.email, 'garnet-locket-7731');
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByTestId('account-menu').click();
    await page.getByTestId('sign-out').click();
    await page.goto(`/reset-password?token=${token}`);
    await page.getByTestId('new-password').fill('another-locket-8842');
    await page.getByTestId('confirm-password').fill('another-locket-8842');
    await page.getByTestId('save-password').click();
    await expect(page.getByTestId('reset-error')).toHaveText('This reset link is invalid or has expired. Request a new one.');
  });
});

test.describe('dashboard and shell', () => {
  test('a salesperson sees their own figures, with profit and stock value withheld', async ({ page }) => {
    await signIn(page, E2E.sales);
    await expect(page.getByTestId('kpi-3')).toContainText('Shown to managers');
    await expect(page.getByTestId('inventory-value')).toHaveCount(0);
    const res = await page.request.get('/api/v1/dashboard/summary');
    expect(res.status()).toBe(401); // the API is never callable with the cookie alone
  });

  test('a manager sees profit and stock value', async ({ page }) => {
    await signIn(page, E2E.manager);
    // A freshly seeded business has no sales this month yet.
    await expect(page.getByTestId('kpi-3')).toContainText(/Margin|No sales yet this month/);
    await expect(page.getByTestId('kpi-3')).not.toContainText('Shown to managers');
    await expect(page.getByTestId('inventory-value')).toContainText('AED');
  });

  test('unknown pages and the forbidden page render inside the app', async ({ page }) => {
    await signIn(page, E2E.manager);
    await page.goto('/no-such-page');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.goto('/forbidden');
    await expect(page.getByRole('heading', { name: "You don't have access to this" })).toBeVisible();
  });

  test('on a phone the navigation is a drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, E2E.manager);
    const nav = page.getByRole('link', { name: 'Dashboard', exact: true });
    await expect(nav).toBeHidden();
    await page.getByTestId('nav-toggle').click();
    await expect(nav).toBeVisible();
    await nav.click();
    await expect(nav).toBeHidden();
  });

  test('the appearance choice applies at once and is remembered', async ({ page }) => {
    await signIn(page, E2E.manager);
    await page.getByTestId('account-menu').click();
    await page.getByTestId('theme-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(23, 17, 18)');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('accessibility (axe, WCAG 2.2 AA rules)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`sign-in and dashboard have no violations (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/sign-in');
      await expect(page.getByTestId('sign-in')).toBeVisible();
      const signInResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(signInResults.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

      await signIn(page, E2E.manager);
      await expect(page.getByTestId('kpi-0')).toBeVisible();
      const dashboard = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(dashboard.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});
