import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerFixture, invoiceFixture, meFixture, previewFixture, productFixture } from '../../../testing/fixtures';
import { apiInterceptor } from '../../core/api/api.interceptor';
import { SessionStore } from '../../core/auth/session.store';
import { Confirm } from '../../shared/ui/confirm-dialog';
import { CustomerForm } from '../customers/components/customer-form';
import { PaymentPanel } from './components/payment-panel';
import { SaleStore } from './state/sale.store';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const PREVIEW = '/api/v1/pricing/preview';
let http: HttpTestingController;

function setup(role: 'MANAGER' | 'SALES' = 'MANAGER', extra: unknown[] = []) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(), provideRouter([]), SaleStore, ...(extra as never[])],
  });
  http = TestBed.inject(HttpTestingController);
  patchState(unprotected(TestBed.inject(SessionStore)), { status: 'signedIn', me: meFixture(role), accessToken: 'a1' });
}

/** A store with one bracelet line and a customer, its preview answered by the "server". */
async function readySale(preview = previewFixture()) {
  const sale = TestBed.inject(SaleStore);
  sale.setTaxRate('t1');
  sale.addLine(productFixture(), 1, 364000, null);
  sale.setCustomer(customerFixture());
  TestBed.tick();
  await wait(300);
  http.expectOne(PREVIEW).flush({ data: preview });
  await wait();
  return sale;
}

beforeEach(() => {
  TestBed.resetTestingModule();
  try {
    localStorage.clear();
  } catch {
    /* jsdom always has it */
  }
});
afterEach(() => http?.verify());

describe('SaleStore', () => {
  it('asks the server for totals once the cart settles, and only trusts an answer for the current cart', async () => {
    setup();
    const sale = TestBed.inject(SaleStore);
    expect(sale.paymentBlocker()).toBe('Add a product to start.');
    sale.setTaxRate('t1');
    sale.addLine(productFixture(), 1, 364000, null);
    sale.addLine(productFixture(), 1, 364000, null); // same product, same price: one line of 2
    TestBed.tick();
    expect(sale.lines()).toHaveLength(1);
    expect(sale.lines()[0]!.quantity).toBe(2);
    http.expectNone(PREVIEW); // debounced
    await wait(300);
    const req = http.expectOne(PREVIEW);
    expect(req.request.body).toEqual({ lines: [{ productId: productFixture().id, quantity: 2, unitPriceMinor: 364000 }], discountMinor: 0, taxRateId: 't1' });

    sale.setDiscount(1000); // changes before the answer arrives
    req.flush({ data: previewFixture() });
    await wait();
    expect(sale.previewCurrent()).toBe(false);
    expect(sale.paymentBlocker()).toBe('Choose a customer.');
    sale.setCustomer(customerFixture());
    TestBed.tick();
    expect(sale.paymentBlocker()).toBe('Updating totals…');
    await wait(300);
    http.expectOne(PREVIEW).flush({
      data: previewFixture({ valid: false, lines: [{ ...previewFixture().lines[0]!, quantity: 2, issues: [{ code: 'INSUFFICIENT_STOCK', available: 1 }] }] }),
    });
    await wait();
    expect(sale.lineIssues()[0]).toEqual([{ code: 'INSUFFICIENT_STOCK', available: 1 }]);
    expect(sale.paymentBlocker()).toBe('Fix the problems shown on the lines.');
    // Stock is not checked for a quotation (rule D4).
    expect(sale.quotationBlocker()).toBeNull();
  });

  it('keeps the sale per user in this browser, without any cost figures', async () => {
    setup();
    const sale = await readySale();
    TestBed.tick();
    const saved = localStorage.getItem('velora.sale.u1')!;
    expect(JSON.parse(saved)).toMatchObject({ customer: { id: customerFixture().id }, lines: [{ productId: productFixture().id, quantity: 1, unitPriceMinor: 364000 }] });
    expect(saved).not.toMatch(/cost/i);
    sale.clear();
    TestBed.tick();
    expect(localStorage.getItem('velora.sale.u1')).toBeNull();
  });

  it('shows a refused discount instead of totals', async () => {
    setup();
    const sale = TestBed.inject(SaleStore);
    sale.addLine(productFixture(), 1, 364000, null);
    sale.setDiscount(999999999);
    TestBed.tick();
    await wait(300);
    http.expectOne(PREVIEW).flush({ error: { code: 'DISCOUNT_EXCEEDS_SUBTOTAL', message: 'x', details: [] } }, { status: 422, statusText: 'Unprocessable' });
    await wait();
    expect(sale.previewFailure()).toMatchObject({ code: 'DISCOUNT_EXCEEDS_SUBTOTAL' });
    sale.setCustomer(customerFixture());
    expect(sale.paymentBlocker()).toContain('could not be calculated');
  });
});

describe('PaymentPanel', () => {
  async function render(confirmAnswer = true) {
    setup('MANAGER', [{ provide: Confirm, useValue: { ask: vi.fn().mockResolvedValue(confirmAnswer) } }]);
    const sale = await readySale();
    const fixture = TestBed.createComponent(PaymentPanel);
    const back = vi.fn();
    const completed = vi.fn();
    fixture.componentInstance.back.subscribe(back);
    fixture.componentInstance.completed.subscribe(completed);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const click = async (testId: string) => {
      el.querySelector<HTMLElement>(`[data-testid="${testId}"] button, button[data-testid="${testId}"]`)!.click();
      await wait();
      fixture.detectChanges();
    };
    return { sale, fixture, el, click, back, completed };
  }

  it('takes half now, says what remains and when it is due, and sends integers with one key', async () => {
    const { el, click, completed } = await render();
    expect(el.querySelector('[data-testid="payment-total"]')!.textContent).toContain('AED 3,822.00');
    await click('pay-half');
    expect(el.querySelector('[data-testid="payment-outcome"]')!.textContent).toMatch(/^Partially paid — AED 1,911\.00 due \d{1,2} \w{3} \d{4}\.$/);
    await click('method-bank');
    await click('confirm-sale');
    await wait();
    const req = http.expectOne('/api/v1/invoices');
    expect(req.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.request.body).toMatchObject({
      customerId: customerFixture().id, quotationId: null, taxRateId: 't1', discountMinor: 0,
      lines: [{ productId: productFixture().id, quantity: 1, unitPriceMinor: 364000 }],
      payment: { amountMinor: 191100, method: 'BANK_TRANSFER', reference: null }, creditDays: 30,
    });
    req.flush({ data: invoiceFixture() }, { status: 201, statusText: 'Created' });
    await wait();
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ number: 'INV-2026-00008' }));
  });

  it('after a lost answer offers only an identical retry with the same key', async () => {
    const { el, fixture, click } = await render();
    await click('confirm-sale');
    await wait();
    let req = http.expectOne('/api/v1/invoices');
    const key = req.request.headers.get('Idempotency-Key');
    req.error(new ProgressEvent('error'));
    await wait();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="payment-error"]')!.textContent).toContain('will not be recorded twice');
    expect(el.querySelector<HTMLButtonElement>('[data-testid="payment-back"]')!.disabled).toBe(true);
    expect(el.querySelector('[data-testid="confirm-sale"]')!.textContent).toContain('Retry');
    await click('confirm-sale');
    await wait();
    req = http.expectOne('/api/v1/invoices');
    expect(req.request.headers.get('Idempotency-Key')).toBe(key);
    req.flush({ data: invoiceFixture() }, { status: 201, statusText: 'Created' });
    await wait();
  });

  it('goes back to the cart when the server refuses the sale, so the problems show on the lines', async () => {
    const { click, back } = await render();
    await click('confirm-sale');
    await wait();
    http.expectOne('/api/v1/invoices').flush(
      { error: { code: 'INSUFFICIENT_STOCK', message: 'x', details: [{ lineNo: 1, code: 'INSUFFICIENT_STOCK', requested: 1, available: 0 }] } },
      { status: 409, statusText: 'Conflict' },
    );
    await wait();
    expect(back).toHaveBeenCalled();
  });

  it('sends nothing when the confirmation is declined, and never more than the total', async () => {
    const { el, click, fixture } = await render(false);
    await click('pay-other');
    const input = el.querySelector<HTMLInputElement>('[data-testid="pay-amount"]')!;
    input.value = '5,000.00';
    input.dispatchEvent(new Event('input'));
    await wait();
    fixture.detectChanges();
    expect(el.textContent).toContain('At most the total, AED 3,822.00.');
    expect(el.querySelector<HTMLButtonElement>('[data-testid="confirm-sale"]')!.disabled).toBe(true);
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    await wait();
    fixture.detectChanges();
    await click('confirm-sale');
    http.expectNone('/api/v1/invoices');
  });
});

describe('CustomerForm', () => {
  it('offers the customer already saved with the same mobile number before creating another', async () => {
    setup();
    const fixture = TestBed.createComponent(CustomerForm);
    const useExisting = vi.fn();
    const saved = vi.fn();
    fixture.componentInstance.useExisting.subscribe(useExisting);
    fixture.componentInstance.saved.subscribe(saved);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const type = (id: string, v: string) => {
      const i = el.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    el.querySelector<HTMLButtonElement>('[data-testid="customer-save"]')!.click();
    await wait();
    fixture.detectChanges();
    expect(el.textContent).toContain('Enter a name or a company.');

    type('customer-name', 'Layla Haddad');
    type('customer-mobile', '055 820 4412');
    el.querySelector<HTMLButtonElement>('[data-testid="customer-save"]')!.click();
    await wait();
    const check = http.expectOne((r) => r.url === '/api/v1/customers' && r.method === 'GET');
    expect(check.request.params.get('mobile')).toBe('055 820 4412');
    check.flush({ data: [customerFixture()], meta: { nextCursor: null, hasMore: false } });
    await wait();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="duplicate-mobile"]')!.textContent).toContain('Maison Luxe · Maya Farah');
    el.querySelector<HTMLButtonElement>('[data-testid="use-existing"]')!.click();
    expect(useExisting).toHaveBeenCalledWith(expect.objectContaining({ id: customerFixture().id }));

    el.querySelector<HTMLButtonElement>('[data-testid="save-anyway"]')!.click();
    await wait();
    const create = http.expectOne((r) => r.url === '/api/v1/customers' && r.method === 'POST');
    expect(create.request.body).toMatchObject({ name: 'Layla Haddad', mobile: '055 820 4412', company: null });
    expect(create.request.headers.get('Idempotency-Key')).toBeTruthy();
    create.flush({ data: customerFixture({ id: 'new', name: 'Layla Haddad', company: null }) }, { status: 201, statusText: 'Created' });
    await wait();
    expect(saved).toHaveBeenCalled();
  });
});
