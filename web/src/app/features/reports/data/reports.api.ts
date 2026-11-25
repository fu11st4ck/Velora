import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { HttpContext } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { TIMEOUT_MS } from '../../../core/api/http-context';
import type { Envelope, Schemas } from '../../../core/api/types';

export type SalesSummary = Schemas['SalesSummary'];
export interface SalesPerson {
  memberId: string;
  fullName: string;
  invoiceCount: number;
  invoicedMinor: number;
  netSalesMinor: number;
  grossProfitMinor?: number;
}
export interface StatusRow {
  status: 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE';
  count: number;
  totalMinor: number;
  balanceMinor: number;
}
export interface ValuationRow {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  costMinor: number;
  valueMinor: number;
}
export interface Valuation {
  rows: ValuationRow[];
  summary: { units?: number; productCount?: number; valueMinor?: number } | undefined;
}

/** A period of business days (YYYY-MM-DD) in the organization's time zone, as the API expects. */
export interface Period {
  from: string;
  to: string;
}

/** Reports (docs/web-api-integration.md). Figures are computed by the server; the page only shows them. */
@Injectable({ providedIn: 'root' })
export class ReportsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/reports`;

  async salesSummary(p: Period): Promise<SalesSummary> {
    return (await firstValueFrom(this.http.get<Envelope<SalesSummary>>(`${this.base}/sales-summary`, { params: { ...p } }))).data;
  }

  async salesBySalesperson(p: Period): Promise<SalesPerson[]> {
    return (await firstValueFrom(this.http.get<Envelope<SalesPerson[]>>(`${this.base}/sales-by-salesperson`, { params: { ...p } }))).data;
  }

  async paymentStatus(p: Period): Promise<StatusRow[]> {
    return (await firstValueFrom(this.http.get<Envelope<StatusRow[]>>(`${this.base}/payment-status`, { params: { ...p } }))).data;
  }

  async valuation(limit = 5): Promise<Valuation> {
    const res = await firstValueFrom(
      this.http.get<{ data: ValuationRow[]; meta: { summary?: Valuation['summary'] } }>(`${this.base}/inventory-valuation`, { params: { sort: '-valueMinor', limit } }),
    );
    return { rows: res.data, summary: res.meta.summary };
  }

  /** The CSV export exactly as the server produces it, with the server's file name. */
  async csv(kind: 'sales' | 'stock', p?: Period): Promise<{ blob: Blob; filename: string }> {
    const url = kind === 'sales' ? `${this.base}/sales-summary` : `${this.base}/inventory-valuation`;
    const res: HttpResponse<Blob> = await firstValueFrom(
      this.http.get(url, {
        params: kind === 'sales' && p ? { ...p } : {},
        headers: new HttpHeaders({ Accept: 'text/csv' }),
        responseType: 'blob',
        observe: 'response',
        context: new HttpContext().set(TIMEOUT_MS, 60_000),
      }),
    );
    const disposition = res.headers.get('content-disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? (kind === 'sales' ? `velora-sales-${p?.from}-to-${p?.to}.csv` : 'velora-stock.csv');
    return { blob: res.body ?? new Blob([]), filename };
  }
}
