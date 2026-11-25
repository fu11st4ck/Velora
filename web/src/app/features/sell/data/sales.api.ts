import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { Envelope, Invoice, Page, PricingPreview, Product, Quotation, TaxRate } from '../../../core/api/types';
import { EntityVersions } from '../../../core/state/entity-versions';

export interface LineBody {
  productId: string;
  quantity: number;
  unitPriceMinor: number;
  belowMinimumReason?: string | null;
}

export interface PricingBody {
  lines: LineBody[];
  discountMinor?: number;
  taxRateId?: string;
}

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER';

export interface InvoiceBody extends PricingBody {
  customerId: string;
  quotationId?: string | null;
  notes?: string | null;
  payment?: { amountMinor: number; method: PaymentMethod; reference?: string | null } | null;
  creditDays?: number | null;
}

export interface QuotationBody extends PricingBody {
  customerId: string;
  notes?: string | null;
}

/** Selling (docs/web-api-integration.md). Prices, totals and stock checks are always the server's. */
@Injectable({ providedIn: 'root' })
export class SalesApi {
  private readonly http = inject(HttpClient);
  private readonly versions = inject(EntityVersions);
  private readonly base = environment.apiBaseUrl;

  /** Products that can be sold now (active, in stock). */
  async sellable(q: string): Promise<Product[]> {
    const params: Record<string, string | number | boolean> = { sellable: true, limit: 20, sort: 'name' };
    if (q) params['q'] = q;
    return (await firstValueFrom(this.http.get<Page<Product>>(`${this.base}/products`, { params }))).data;
  }

  async product(id: string): Promise<Product> {
    return (await firstValueFrom(this.http.get<Envelope<Product>>(`${this.base}/products/${encodeURIComponent(id)}`))).data;
  }

  async taxRates(): Promise<TaxRate[]> {
    return (await firstValueFrom(this.http.get<Envelope<TaxRate[]>>(`${this.base}/tax-rates`))).data;
  }

  async preview(body: PricingBody): Promise<PricingPreview> {
    return (await firstValueFrom(this.http.post<Envelope<PricingPreview>>(`${this.base}/pricing/preview`, body))).data;
  }

  async quotation(id: string): Promise<Quotation> {
    return (await firstValueFrom(this.http.get<Envelope<Quotation>>(`${this.base}/quotations/${encodeURIComponent(id)}`))).data;
  }

  async createInvoice(body: InvoiceBody, idempotencyKey: string): Promise<Invoice> {
    const res = await firstValueFrom(this.http.post<Envelope<Invoice>>(`${this.base}/invoices`, body, { headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }) }));
    this.versions.bump('documents', 'stock', 'products', 'customers', 'payments');
    return res.data;
  }

  async createQuotation(body: QuotationBody, idempotencyKey: string): Promise<Quotation> {
    const res = await firstValueFrom(this.http.post<Envelope<Quotation>>(`${this.base}/quotations`, body, { headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }) }));
    this.versions.bump('documents', 'customers');
    return res.data;
  }
}
