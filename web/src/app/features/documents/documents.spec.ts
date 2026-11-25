import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter, Router } from '@angular/router';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoiceFixture, meFixture } from '../../../testing/fixtures';
import { apiInterceptor } from '../../core/api/api.interceptor';
import type { Invoice } from '../../core/api/types';
import { SessionStore } from '../../core/auth/session.store';
import { Confirm } from '../../shared/ui/confirm-dialog';
import { CancelInvoiceDialog, RecordPaymentDialog } from './components/invoice-dialogs';
import { invoiceStatus, whatsappLink } from './data/labels';
import { ReturnPage } from './pages/return.page';

const wait = () => new Promise((r) => setTimeout(r, 0));
let http: HttpTestingController;

function setup(extra: unknown[] = []) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(), provideRouter([{ path: '**', children: [] }]), ...(extra as never[])],
  });
  http = TestBed.inject(HttpTestingController);
  patchState(unprotected(TestBed.inject(SessionStore)), { status: 'signedIn', me: meFixture('MANAGER'), accessToken: 'a1' });
}

async function dialog<T>(component: Type<T>, invoice: Invoice) {
  const close = vi.fn();
  setup([{ provide: MAT_DIALOG_DATA, useValue: invoice }, { provide: MatDialogRef, useValue: { close, disableClose: false } }]);
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const type = async (id: string, v: string) => {
    const i = el.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
    i.value = v;
    i.dispatchEvent(new Event('input'));
    await wait();
    fixture.detectChanges();
  };
  const click = async (selector: string) => {
    el.querySelector<HTMLElement>(selector)!.click();
    await wait();
    fixture.detectChanges();
  };
  return { fixture, el, close, type, click };
}

beforeEach(() => TestBed.resetTestingModule());
afterEach(() => http?.verify());

describe('labels', () => {
  it('shows the same status priority as the list', () => {
    expect(invoiceStatus({ status: 'CANCELLED', isOverdue: true, paymentStatus: 'UNPAID' }).label).toBe('Cancelled');
    expect(invoiceStatus({ status: 'ISSUED', isOverdue: true, paymentStatus: 'PARTIAL' }).label).toBe('Overdue');
    expect(invoiceStatus({ status: 'ISSUED', isOverdue: false, paymentStatus: 'PARTIAL' }).label).toBe('Partially paid');
    expect(whatsappLink('+971 55 820 4412', 'Hi & bye')).toBe('https://wa.me/971558204412?text=Hi%20%26%20bye');
    expect(whatsappLink(null, 'x')).toBeNull();
  });
});

describe('RecordPaymentDialog', () => {
  it('defaults to the balance, refuses more, and sends integers with an idempotency key', async () => {
    const { el, close, type, click } = await dialog(RecordPaymentDialog, invoiceFixture());
    expect(el.querySelector<HTMLInputElement>('[data-testid="payment-amount"]')!.value).toBe('1,911.00');
    expect(el.querySelector('[data-testid="payment-outcome"]')!.textContent).toContain('paid in full');
    await type('payment-amount', '1,911.01');
    await click('[data-testid="payment-submit"]');
    expect(el.textContent).toContain('At most the balance, AED 1,911.00.');
    http.expectNone((r) => r.url.includes('/payments'));
    await type('payment-amount', '911.00');
    expect(el.querySelector('[data-testid="payment-outcome"]')!.textContent).toContain('AED 1,000.00 will remain');
    await click('[data-testid="payment-submit"]');
    const req = http.expectOne('/api/v1/invoices/inv1/payments');
    expect(req.request.body).toEqual({ amountMinor: 91100, method: 'CASH', reference: null, note: null });
    expect(req.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    req.flush({ data: { payment: {}, invoice: invoiceFixture({ balanceMinor: 100000 }) } }, { status: 201, statusText: 'Created' });
    await wait();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ balanceMinor: 100000 }));
  });
});

describe('CancelInvoiceDialog', () => {
  it('needs a reason and, when money was received, how it is refunded', async () => {
    const { el, type, click } = await dialog(CancelInvoiceDialog, invoiceFixture());
    expect(el.textContent).toContain('1 item goes back to stock.');
    expect(el.textContent).toContain('AED 1,911.00 received is recorded as refunded.');
    await type('cancel-reason', 'Wrong customer');
    await click('[data-testid="cancel-submit"]');
    http.expectNone((r) => r.url.includes('/cancel'));
    await click('[data-testid="cancel-cash"] button');
    await click('[data-testid="cancel-submit"]');
    const req = http.expectOne('/api/v1/invoices/inv1/cancel');
    expect(req.request.body).toEqual({ reason: 'Wrong customer', refundMethod: 'CASH', refundReference: null });
    req.flush({ data: invoiceFixture({ status: 'CANCELLED' }) });
    await wait();
  });
});

describe('ReturnPage', () => {
  it('sends the return, and asks for the refund method only when the server says a refund is due', async () => {
    setup([{ provide: Confirm, useValue: { ask: vi.fn().mockResolvedValue(true) } }]);
    const invoice = invoiceFixture({ lines: [{ lineNo: 1, productId: 'p1', name: 'Ring', sku: 'R1', quantity: 2, returnedQuantity: 0, unitPriceMinor: 130000, lineTotalMinor: 260000 }] });
    const fixture = TestBed.createComponent(ReturnPage);
    fixture.componentRef.setInput('id', 'inv1');
    fixture.detectChanges();
    await wait();
    http.expectOne('/api/v1/invoices/inv1').flush({ data: invoice });
    await wait();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = async (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      await wait();
      await wait();
      fixture.detectChanges();
    };
    await click('[data-testid="return-more"]');
    await click('[data-testid="return-restock"] button');
    const reason = el.querySelector<HTMLInputElement>('[data-testid="return-reason"]')!;
    reason.value = 'Damaged';
    reason.dispatchEvent(new Event('input'));
    await click('[data-testid="return-submit"]');
    const first = http.expectOne('/api/v1/invoices/inv1/returns');
    expect(first.request.body).toEqual({ reason: 'Damaged', lines: [{ lineNo: 1, quantity: 1, restock: false }] });
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush({ error: { code: 'REFUND_METHOD_REQUIRED', message: 'x', details: [{ refundMinor: 63500 }] } }, { status: 422, statusText: 'Unprocessable' });
    await wait();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="return-refund-due"]')!.textContent).toContain('AED 635.00 must be refunded');
    expect(el.querySelector<HTMLButtonElement>('[data-testid="return-submit"]')!.disabled).toBe(true);
    await click('[data-testid="return-refund-cash"] button');
    await click('[data-testid="return-submit"]');
    const second = http.expectOne('/api/v1/invoices/inv1/returns');
    expect(second.request.body).toEqual({ reason: 'Damaged', lines: [{ lineNo: 1, quantity: 1, restock: false }], refund: { method: 'CASH', reference: null } });
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(firstKey); // a different request now
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    second.flush({ data: { return: { number: 'CN-2026-00001', totalMinor: 136500, refundMinor: 63500 }, invoice } }, { status: 201, statusText: 'Created' });
    await wait();
    expect(navigate).toHaveBeenCalledWith(['/documents/invoices', 'inv1']);
  });
});
