import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { Customer, CustomerDetail, CustomerInput, DocumentSummary, Envelope, Page } from '../../../core/api/types';
import { EntityVersions } from '../../../core/state/entity-versions';

export type CustomerSort = 'name' | '-createdAt';

export interface CustomerQuery {
  q?: string;
  sort?: CustomerSort;
  limit?: number;
}

/** Customers (docs/web-api-integration.md). Edits are last-write-wins on the server (no version field). */
@Injectable({ providedIn: 'root' })
export class CustomersApi {
  private readonly http = inject(HttpClient);
  private readonly versions = inject(EntityVersions);
  private readonly base = environment.apiBaseUrl;

  list(query: CustomerQuery, cursor: string | null): Promise<Page<Customer>> {
    let params = new HttpParams();
    if (query.q) params = params.set('q', query.q);
    if (query.sort) params = params.set('sort', query.sort);
    if (query.limit) params = params.set('limit', query.limit);
    if (cursor) params = params.set('cursor', cursor);
    return firstValueFrom(this.http.get<Page<Customer>>(`${this.base}/customers`, { params }));
  }

  /** Customers already saved with this number; the server normalizes it the same way it stores it. */
  async withMobile(mobile: string): Promise<Customer[]> {
    const res = await firstValueFrom(this.http.get<Page<Customer>>(`${this.base}/customers`, { params: { mobile, limit: 5 } }));
    return res.data;
  }

  async get(id: string): Promise<CustomerDetail> {
    return (await firstValueFrom(this.http.get<Envelope<CustomerDetail>>(`${this.base}/customers/${encodeURIComponent(id)}`))).data;
  }

  async create(body: CustomerInput, idempotencyKey: string): Promise<Customer> {
    const res = await firstValueFrom(this.http.post<Envelope<Customer>>(`${this.base}/customers`, body, { headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }) }));
    this.versions.bump('customers');
    return res.data;
  }

  async update(id: string, body: CustomerInput): Promise<Customer> {
    const res = await firstValueFrom(this.http.patch<Envelope<Customer>>(`${this.base}/customers/${encodeURIComponent(id)}`, body));
    this.versions.bump('customers');
    return res.data;
  }

  async archive(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${this.base}/customers/${encodeURIComponent(id)}`));
    this.versions.bump('customers');
  }

  documents(customerId: string, cursor: string | null): Promise<Page<DocumentSummary>> {
    let params = new HttpParams().set('customerId', customerId).set('limit', 20);
    if (cursor) params = params.set('cursor', cursor);
    return firstValueFrom(this.http.get<Page<DocumentSummary>>(`${this.base}/documents`, { params }));
  }
}

/** "Maison Luxe · Maya Farah", or whichever of the two exists. */
export function customerLabel(c: Pick<Customer, 'name' | 'company'>): string {
  return [c.company, c.name].filter((x): x is string => !!x).join(' · ');
}
