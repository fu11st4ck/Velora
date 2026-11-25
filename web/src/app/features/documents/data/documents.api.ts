import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { TIMEOUT_MS } from '../../../core/api/http-context';
import { HttpContext } from '@angular/common/http';
import type { DocumentSummary, Envelope, Invoice, Member, Page, Payment, Quotation, SalesReturn } from '../../../core/api/types';
import { EntityVersions } from '../../../core/state/entity-versions';

export type DocumentType = 'invoice' | 'quotation';
export type DocumentStatusFilter =
  | 'paid' | 'partial' | 'unpaid' | 'overdue' | 'cancelled'
  | 'quotation_open' | 'quotation_converted' | 'quotation_expired' | 'quotation_cancelled';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER';

export interface DocumentQuery {
  type?: DocumentType;
  status?: DocumentStatusFilter[];
  q?: string;
  salespersonId?: string;
  /** Business days (YYYY-MM-DD) in the organization's time zone, as the API expects. */
  from?: string;
  to?: string;
  limit?: number;
}

export interface PaymentResult {
  payment: Payment;
  invoice: Invoice;
}

export interface ReturnResult {
  return: SalesReturn;
  invoice: Invoice;
}

export interface ReturnBody {
  reason: string;
  lines: { lineNo: number; quantity: number; restock: boolean }[];
  refund?: { method: PaymentMethod; reference?: string | null } | null;
}

const key = (k: string) => ({ headers: new HttpHeaders({ 'Idempotency-Key': k }) });

/** Documents and their money (docs/web-api-integration.md). Every amount is the server's. */
@Injectable({ providedIn: 'root' })
export class DocumentsApi {
  private readonly http = inject(HttpClient);
  private readonly versions = inject(EntityVersions);
  private readonly base = environment.apiBaseUrl;

  list(query: DocumentQuery, cursor: string | null): Promise<Page<DocumentSummary>> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
      p = p.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    if (cursor) p = p.set('cursor', cursor);
    return firstValueFrom(this.http.get<Page<DocumentSummary>>(`${this.base}/documents`, { params: p }));
  }

  async members(): Promise<Member[]> {
    return (await firstValueFrom(this.http.get<Envelope<Member[]>>(`${this.base}/organization/members`))).data;
  }

  async recordPayment(invoiceId: string, body: { amountMinor: number; method: PaymentMethod; reference?: string | null; note?: string | null }, idempotencyKey: string): Promise<PaymentResult> {
    const res = await firstValueFrom(this.http.post<Envelope<PaymentResult>>(`${this.base}/invoices/${encodeURIComponent(invoiceId)}/payments`, body, key(idempotencyKey)));
    this.versions.bump('documents', 'payments', 'customers');
    return res.data;
  }

  async refund(invoiceId: string, body: { amountMinor: number; method: PaymentMethod; reference?: string | null; note: string }, idempotencyKey: string): Promise<PaymentResult> {
    const res = await firstValueFrom(this.http.post<Envelope<PaymentResult>>(`${this.base}/invoices/${encodeURIComponent(invoiceId)}/refunds`, body, key(idempotencyKey)));
    this.versions.bump('documents', 'payments', 'customers');
    return res.data;
  }

  async cancelInvoice(invoiceId: string, body: { reason: string; refundMethod?: PaymentMethod; refundReference?: string | null }, idempotencyKey: string): Promise<Invoice> {
    const res = await firstValueFrom(this.http.post<Envelope<Invoice>>(`${this.base}/invoices/${encodeURIComponent(invoiceId)}/cancel`, body, key(idempotencyKey)));
    this.versions.bump('documents', 'payments', 'customers', 'stock', 'products');
    return res.data;
  }

  async createReturn(invoiceId: string, body: ReturnBody, idempotencyKey: string): Promise<ReturnResult> {
    const res = await firstValueFrom(this.http.post<Envelope<ReturnResult>>(`${this.base}/invoices/${encodeURIComponent(invoiceId)}/returns`, body, key(idempotencyKey)));
    this.versions.bump('documents', 'payments', 'customers', 'stock', 'products');
    return res.data;
  }

  async cancelQuotation(id: string, reason: string | null): Promise<Quotation> {
    const res = await firstValueFrom(this.http.post<Envelope<Quotation>>(`${this.base}/quotations/${encodeURIComponent(id)}/cancel`, { reason }));
    this.versions.bump('documents');
    return res.data;
  }

  /** The document's PDF as the server renders it (bearer token via the interceptor, so not a plain link). */
  pdf(kind: DocumentType, id: string): Promise<Blob> {
    const path = kind === 'invoice' ? 'invoices' : 'quotations';
    return firstValueFrom(
      this.http.get(`${this.base}/${path}/${encodeURIComponent(id)}/pdf`, { responseType: 'blob', context: new HttpContext().set(TIMEOUT_MS, 60_000) }),
    );
  }
}
