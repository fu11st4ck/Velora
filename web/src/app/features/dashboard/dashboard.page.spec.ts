import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { dashboardFixture, meFixture } from '../../../testing/fixtures';
import { apiInterceptor } from '../../core/api/api.interceptor';
import { SessionStore } from '../../core/auth/session.store';
import { EntityVersions } from '../../core/state/entity-versions';
import { DashboardPage } from './dashboard.page';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('DashboardPage', () => {
  let http: HttpTestingController;

  function signedInAs(role: 'MANAGER' | 'SALES') {
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    patchState(unprotected(TestBed.inject(SessionStore)), { status: 'signedIn', me: meFixture(role), accessToken: 'a1' });
  }

  async function render() {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    await settle(); // not whenStable(): the pending request keeps the app unstable until flushed
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  // One string per tile: its lines joined with spaces (the icon ligature reads as its name).
  const tiles = (el: HTMLElement) =>
    [...el.querySelectorAll('app-kpi-tile')].map((t) => [...t.querySelectorAll('p')].map((p) => p.textContent!.replace(/\s+/g, ' ').trim()).join(' '));

  beforeEach(() => TestBed.resetTestingModule());

  it('shows a manager every figure, in the organization currency', async () => {
    signedInAs('MANAGER');
    const { fixture, el } = await render();
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne('/api/v1/dashboard/summary').flush({ data: dashboardFixture('MANAGER') });
    await settle();
    await fixture.whenStable();
    expect(tiles(el)).toEqual([
      "Today's sales AED 10,694.25 2 invoices Up 12.4% on yesterday",
      'Outstanding AED 12,500.00 3 invoices Overdue AED 3,500.00',
      'In stock 53 pcs 4 products',
      "This month's profit AED 18,450.00 Margin 24.5%",
    ]);
    expect(el.querySelector('[data-testid="inventory-value"]')!.textContent).toContain('AED 150,850.00');
    expect(el.textContent).toContain('1 product is out of stock');
    expect(el.textContent).toContain('2 products are low in stock');
    expect(el.textContent).toContain('1 invoice overdue · AED 3,500.00');
    const doc = el.querySelector('[data-testid="recent-document"]')!.textContent!.replace(/\s+/g, ' ');
    expect(doc).toContain('INV-2026-00007');
    expect(doc).toContain('Partially paid');
    expect(doc).toContain('25 Nov 2026 · Ahmed Karim · Balance AED 675.00 · due 25 Dec 2026');
  });

  it('withholds profit and stock value from a salesperson', async () => {
    signedInAs('SALES');
    const { fixture, el } = await render();
    http.expectOne('/api/v1/dashboard/summary').flush({ data: dashboardFixture('SALES') });
    await settle();
    await fixture.whenStable();
    expect(tiles(el)[3]).toBe("This month's profit lockShown to managers");
    expect(el.querySelector('[data-testid="inventory-value"]')).toBeNull();
  });

  it('explains a failed load and loads again on request', async () => {
    signedInAs('MANAGER');
    const { fixture, el } = await render();
    http.expectOne('/api/v1/dashboard/summary').flush({ error: { code: 'INTERNAL_ERROR', requestId: 'req_42' } }, { status: 500, statusText: 'Error' });
    await settle();
    await fixture.whenStable();
    expect(el.textContent).toContain('Could not load the dashboard');
    expect(el.textContent).toContain('(Ref req_42)');
    (el.querySelector('app-state-view button') as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/v1/dashboard/summary').flush({ data: dashboardFixture() });
    await settle();
    await fixture.whenStable();
    expect(tiles(el)).toHaveLength(4);
  });

  it('loads again when a sale or stock change happens elsewhere in the app', async () => {
    signedInAs('MANAGER');
    const { fixture } = await render();
    http.expectOne('/api/v1/dashboard/summary').flush({ data: dashboardFixture() });
    await settle();
    TestBed.inject(EntityVersions).bump('documents');
    fixture.detectChanges();
    await settle();
    http.expectOne('/api/v1/dashboard/summary').flush({ data: dashboardFixture() });
    TestBed.inject(EntityVersions).bump('team'); // unrelated: nothing is fetched
    fixture.detectChanges();
    await settle();
    http.expectNone('/api/v1/dashboard/summary');
  });
});
