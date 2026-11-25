import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meFixture, movementFixture, productFixture } from '../../../testing/fixtures';
import { apiInterceptor } from '../../core/api/api.interceptor';
import type { Product } from '../../core/api/types';
import { SessionStore } from '../../core/auth/session.store';
import { EntityVersions } from '../../core/state/entity-versions';
import { activeNavPath, NAVIGATION, visibleNavigation } from '../../layout/navigation';
import { PagedList } from '../../shared/table/paged-list';
import { AdjustStockDialog } from './components/stock-dialogs';
import { ProductFormPage } from './pages/product-form.page';
import { ProductsPage } from './pages/products.page';
import { StockHistoryPage } from './pages/stock-history.page';

const settle = () => new Promise((r) => setTimeout(r, 0));
const UUID = /^[0-9a-f-]{36}$/;
let http: HttpTestingController;

function setup(role: 'MANAGER' | 'SALES', extra: unknown[] = []) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(), provideRouter([{ path: '**', children: [] }]), ...(extra as never[])],
  });
  http = TestBed.inject(HttpTestingController);
  patchState(unprotected(TestBed.inject(SessionStore)), { status: 'signedIn', me: meFixture(role), accessToken: 'a1' });
}

async function render<T>(component: Type<T>, inputs: Record<string, unknown> = {}) {
  const fixture = TestBed.createComponent(component);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  await settle();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

async function refresh(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  await settle();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function type(el: HTMLElement, testId: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

const page = (data: Product[], hasMore = false) => ({
  data,
  meta: { nextCursor: hasMore ? 'c2' : null, hasMore, counts: { all: 11, inStock: 2, low: 6, out: 3 } },
});

beforeEach(() => TestBed.resetTestingModule());
afterEach(() => http?.verify());

describe('PagedList', () => {
  it('ignores a late answer to an earlier query, appends pages and keeps rows when loading more fails', async () => {
    const list = new PagedList<number>();
    let resolveOld!: (v: { data: number[]; meta: { nextCursor: null; hasMore: false } }) => void;
    void list.load(() => new Promise((r) => (resolveOld = r)));
    await list.load(async (cursor) => (cursor ? { data: [3], meta: { nextCursor: null, hasMore: false } } : { data: [1, 2], meta: { nextCursor: 'c', hasMore: true } }));
    resolveOld({ data: [99], meta: { nextCursor: null, hasMore: false } });
    await settle();
    expect(list.items()).toEqual([1, 2]);
    await list.more();
    expect(list.items()).toEqual([1, 2, 3]);
    expect(list.hasMore()).toBe(false);

    await list.load(async (cursor) => {
      if (cursor) throw new Error('offline');
      return { data: [1], meta: { nextCursor: 'c', hasMore: true } };
    });
    await list.more();
    expect(list.items()).toEqual([1]);
    expect(list.moreFailure()).not.toBeNull();
  });
});

describe('navigation', () => {
  it('highlights the most specific entry for the current page', () => {
    const groups = visibleNavigation(() => true, NAVIGATION);
    expect(activeNavPath('/inventory', groups)).toBe('/inventory');
    expect(activeNavPath('/inventory/abc?x=1', groups)).toBe('/inventory');
    expect(activeNavPath('/inventory/history?product=1', groups)).toBe('/inventory/history');
    expect(activeNavPath('/inventoryx', groups)).toBeNull();
  });
});

describe('ProductsPage', () => {
  it('sends the filters from the URL, shows server counts and cost columns to a manager', async () => {
    setup('MANAGER');
    await TestBed.inject(Router).navigateByUrl('/inventory?q=gold&stock=low&sort=-quantity');
    const { fixture, el } = await render(ProductsPage);
    const req = http.expectOne((r) => r.url === '/api/v1/products');
    expect(req.request.params.toString()).toBe('q=gold&stockStatus=low&sort=-quantity&limit=25');
    req.flush(page([productFixture({ stockStatus: 'LOW', quantity: 8 })]));
    await refresh(fixture);
    expect(el.querySelector('[data-testid="stock-low"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('[data-testid="stock-low"]')!.textContent).toContain('6');
    const headers = [...el.querySelectorAll('th')].map((th) => th.textContent!.trim());
    expect(headers).toEqual(expect.arrayContaining(['Cost', 'Value at cost']));
    const row = el.querySelector('[data-testid="product-row"]')!.textContent!.replace(/\s+/g, ' ');
    expect(el.querySelector('[data-testid="available"] .qty')!.textContent!.trim()).toBe('8');
    expect(el.querySelector('[data-testid="available"] app-status-pill')!.textContent!.trim()).toBe('Low stock');
    expect(row).toContain('AED 22,400.00'); // 8 × 2,800.00 at cost
    expect(el.querySelector('[data-testid="product-actions"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="new-product"]')).not.toBeNull();
  });

  it('shows a salesperson no cost columns and no management actions', async () => {
    setup('SALES');
    await TestBed.inject(Router).navigateByUrl('/inventory?archived=1');
    const { fixture, el } = await render(ProductsPage);
    const req = http.expectOne((r) => r.url === '/api/v1/products');
    expect(req.request.params.has('includeArchived')).toBe(false);
    req.flush(page([productFixture({}, 'SALES')]));
    await refresh(fixture);
    const headers = [...el.querySelectorAll('th')].map((th) => th.textContent!.trim());
    expect(headers).not.toContain('Cost');
    expect(headers).not.toContain('Value at cost');
    expect(el.querySelector('[data-testid="product-actions"]')).toBeNull();
    expect(el.querySelector('[data-testid="new-product"]')).toBeNull();
    expect(el.querySelector('[data-testid="show-archived"]')).toBeNull();
  });

  it('loads the next page with the cursor, and fetches again after a stock change', async () => {
    setup('MANAGER');
    await TestBed.inject(Router).navigateByUrl('/inventory');
    const { fixture, el } = await render(ProductsPage);
    http.expectOne((r) => r.url === '/api/v1/products').flush(page([productFixture()], true));
    await refresh(fixture);
    el.querySelector<HTMLButtonElement>('[data-testid="load-more"]')!.click();
    const more = http.expectOne((r) => r.url === '/api/v1/products');
    expect(more.request.params.get('cursor')).toBe('c2');
    more.flush(page([productFixture({ id: 'p2', name: 'Second' })]));
    await refresh(fixture);
    expect(el.querySelectorAll('[data-testid="product-row"]').length).toBe(2);

    TestBed.inject(EntityVersions).bump('stock');
    await refresh(fixture);
    const again = http.expectOne((r) => r.url === '/api/v1/products');
    expect(again.request.params.has('cursor')).toBe(false);
    again.flush(page([productFixture()]));
  });
});

describe('ProductFormPage', () => {
  it('creates a product with integer minor units, basis points and an idempotency key', async () => {
    setup('MANAGER');
    const { fixture, el } = await render(ProductFormPage);
    type(el, 'product-name', 'Rose Gold Cuff');
    type(el, 'product-cost', '2,450.50');
    type(el, 'product-default-markup', '30');
    type(el, 'product-min-markup', '12.5');
    type(el, 'product-opening', '4');
    await refresh(fixture);
    expect(el.querySelector('[data-testid="preview-list"]')!.textContent).toContain('AED 3,185.65'); // 245050 × 1.3 = 318565
    el.querySelector<HTMLButtonElement>('[data-testid="product-save"]')!.click();
    await settle();
    const req = http.expectOne('/api/v1/products');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(req.request.body).toMatchObject({ name: 'Rose Gold Cuff', sku: null, costMinor: 245050, defaultMarkupBp: 3000, minMarkupBp: 1250, openingQuantity: 4, reorderLevel: null, weight: null });
    req.flush({ data: productFixture({ id: 'new1', name: 'Rose Gold Cuff' }) }, { status: 201, statusText: 'Created' });
    await settle();
  });

  it('refuses a minimum markup above the default and a default above the organization maximum without sending', async () => {
    setup('MANAGER');
    const { fixture, el } = await render(ProductFormPage);
    type(el, 'product-name', 'Ring');
    type(el, 'product-cost', '100');
    type(el, 'product-default-markup', '20');
    type(el, 'product-min-markup', '25');
    el.querySelector<HTMLButtonElement>('[data-testid="product-save"]')!.click();
    await refresh(fixture);
    expect(el.textContent).toContain('The minimum markup must not exceed the default markup.');
    type(el, 'product-min-markup', '10');
    type(el, 'product-default-markup', '61');
    await refresh(fixture);
    expect(el.textContent).toContain('At most 60%');
    http.expectNone('/api/v1/products');
  });

  it('edits with the loaded version, keeps cost read-only, and explains a version conflict', async () => {
    setup('MANAGER');
    const id = productFixture().id;
    const { fixture, el } = await render(ProductFormPage, { id });
    http.expectOne(`/api/v1/products/${id}`).flush({ data: productFixture() });
    await refresh(fixture);
    expect(el.querySelector<HTMLInputElement>('[data-testid="product-cost"]')!.disabled).toBe(true);
    expect(el.querySelector('[data-testid="product-opening"]')).toBeNull();
    type(el, 'product-name', 'Alhambra Bracelet');
    el.querySelector<HTMLButtonElement>('[data-testid="product-save"]')!.click();
    await settle();
    const req = http.expectOne(`/api/v1/products/${id}`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toMatchObject({ version: 3, name: 'Alhambra Bracelet', sku: 'VLR-BR-001', defaultMarkupBp: 3000, minMarkupBp: 1500, weight: { value: '12.8', unit: 'G' } });
    expect(req.request.body).not.toHaveProperty('costMinor');
    req.flush({ error: { code: 'VERSION_CONFLICT', message: 'changed', details: [{ currentVersion: 4 }] } }, { status: 409, statusText: 'Conflict' });
    await refresh(fixture);
    expect(el.querySelector('[data-testid="version-conflict"]')).not.toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-testid="product-save"]')!.disabled).toBe(true);
    el.querySelector<HTMLButtonElement>('[data-testid="conflict-reload"]')!.click();
    http.expectOne(`/api/v1/products/${id}`).flush({ data: productFixture({ version: 4, name: 'Changed elsewhere' }) });
    await refresh(fixture);
    expect(el.querySelector('[data-testid="version-conflict"]')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('[data-testid="product-name"]')!.value).toBe('Changed elsewhere');
  });

  it('puts a taken SKU next to the SKU field', async () => {
    setup('MANAGER');
    const { fixture, el } = await render(ProductFormPage);
    type(el, 'product-name', 'Ring');
    type(el, 'product-sku', 'VLR-BR-001');
    type(el, 'product-cost', '100');
    type(el, 'product-default-markup', '20');
    type(el, 'product-min-markup', '10');
    el.querySelector<HTMLButtonElement>('[data-testid="product-save"]')!.click();
    await settle();
    http.expectOne('/api/v1/products').flush({ error: { code: 'SKU_TAKEN', message: 'taken', details: [{ field: 'sku' }] } }, { status: 409, statusText: 'Conflict' });
    await refresh(fixture);
    expect(el.textContent).toContain('Another product already uses this SKU.');
  });
});

describe('AdjustStockDialog', () => {
  async function open(product: Product) {
    const close = vi.fn();
    setup('MANAGER', [
      { provide: MAT_DIALOG_DATA, useValue: product },
      { provide: MatDialogRef, useValue: { close } },
    ]);
    const r = await render(AdjustStockDialog);
    return { ...r, close };
  }

  it('will not remove more than is on hand, and sends removals as a negative change with one key across retries', async () => {
    const { fixture, el, close } = await open(productFixture({ quantity: 3 }));
    el.querySelector<HTMLElement>('[data-testid="adjust-out"] input')!.click();
    type(el, 'adjust-quantity', '5');
    type(el, 'adjust-reason', 'Damaged');
    el.querySelector<HTMLButtonElement>('[data-testid="adjust-submit"]')!.click();
    await refresh(fixture);
    expect(el.textContent).toContain('Only 3 on hand.');
    http.expectNone('/api/v1/inventory/adjustments');

    type(el, 'adjust-quantity', '2');
    el.querySelector<HTMLButtonElement>('[data-testid="adjust-submit"]')!.click();
    await settle();
    let req: TestRequest = http.expectOne('/api/v1/inventory/adjustments');
    expect(req.request.body).toEqual({ productId: productFixture().id, quantityDelta: -2, reason: 'Damaged' });
    const key = req.request.headers.get('Idempotency-Key');
    req.error(new ProgressEvent('error')); // the answer is lost
    await refresh(fixture);
    expect(el.querySelector('[data-testid="dialog-error"]')!.textContent).toContain('will not be recorded twice');
    el.querySelector<HTMLButtonElement>('[data-testid="adjust-submit"]')!.click();
    await settle();
    req = http.expectOne('/api/v1/inventory/adjustments');
    expect(req.request.headers.get('Idempotency-Key')).toBe(key);
    req.flush({ data: { movement: movementFixture(), product: productFixture({ quantity: 1 }) } }, { status: 201, statusText: 'Created' });
    await settle();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ product: expect.objectContaining({ quantity: 1 }) }));
  });
});

describe('StockHistoryPage', () => {
  it('turns business days into instants in the organization time zone', async () => {
    setup('MANAGER');
    await TestBed.inject(Router).navigateByUrl('/inventory/history?from=2026-11-25&to=2026-11-25&type=SALE,ADJUSTMENT_OUT,BOGUS');
    const { fixture, el } = await render(StockHistoryPage);
    const req = http.expectOne((r) => r.url === '/api/v1/inventory/movements');
    // Asia/Dubai is UTC+4: the 25th runs from 20:00 on the 24th to 19:59:59.999 on the 25th (UTC).
    expect(req.request.params.get('from')).toBe('2026-11-24T20:00:00.000Z');
    expect(req.request.params.get('to')).toBe('2026-11-25T19:59:59.999Z');
    expect(req.request.params.get('type')).toBe('SALE,ADJUSTMENT_OUT');
    req.flush({ data: [movementFixture()], meta: { nextCursor: null, hasMore: false } });
    await refresh(fixture);
    const row = el.querySelector('[data-testid="history-row"]')!.textContent!.replace(/\s+/g, ' ');
    expect(row).toContain('25 Nov 2026, 01:05'); // shown in Dubai time, not the browser's
    expect(row).toContain('−2');
    expect(row).toContain('Damaged clasp');
  });

  it('does not ask the server when the range is reversed', async () => {
    setup('SALES');
    await TestBed.inject(Router).navigateByUrl('/inventory/history?from=2026-11-26&to=2026-11-25');
    const { el } = await render(StockHistoryPage);
    http.expectNone((r) => r.url === '/api/v1/inventory/movements');
    expect(el.textContent).toContain('The From date is after the To date.');
  });
});
