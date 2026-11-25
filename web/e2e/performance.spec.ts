import { expect, test, type Page } from '@playwright/test';
import { E2E } from './env';
import { signIn } from './support';

/**
 * W6 performance budget (docs/web-frontend-architecture.md §5): LCP ≤ 2.5 s on a mid-range laptop
 * over 4G. Emulated with Chrome DevTools: CPU slowed 4×, network ~9 Mbit/s down, 1.5 up, 150 ms
 * latency. The test server sends files uncompressed (Caddy compresses them in production), so the
 * figures here are pessimistic.
 */
async function throttle(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
}

async function measure(page: Page, path: string, ready: string): Promise<{ lcp: number; bytes: number }> {
  await page.goto(path, { waitUntil: 'load' });
  await expect(page.getByTestId(ready).first()).toBeVisible({ timeout: 20_000 });
  return page.evaluate(
    () =>
      new Promise<{ lcp: number; bytes: number }>((resolve) => {
        let lcp = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) lcp = Math.max(lcp, e.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => {
          const bytes = performance.getEntriesByType('resource').reduce((n, r) => n + ((r as PerformanceResourceTiming).transferSize || 0), 0);
          resolve({ lcp, bytes });
        }, 500);
      }),
  );
}

test('dashboard and products render their main content within 2.5 s on a throttled laptop', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/sign-in');
  await signIn(page, E2E.manager); // the refresh cookie lets the measured loads restore the session
  await throttle(page);
  const results: Record<string, { lcp: number; bytes: number }> = {};
  results['sign-in (signed out)'] = await (async () => {
    const other = await page.context().browser()!.newPage();
    await throttle(other);
    const r = await measure(other, '/sign-in', 'sign-in');
    await other.close();
    return r;
  })();
  results['dashboard'] = await measure(page, '/dashboard', 'kpi-0');
  results['products'] = await measure(page, '/inventory', 'product-row');
  console.log(JSON.stringify(results, null, 2));
  for (const [name, r] of Object.entries(results)) expect(r.lcp, `${name} LCP`).toBeLessThan(2500);
});
