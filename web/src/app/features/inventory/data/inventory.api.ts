import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { Envelope, Page, PageMeta, Product, ProductCreate, ProductUpdate, StockMovement } from '../../../core/api/types';
import { EntityVersions } from '../../../core/state/entity-versions';

export type ProductSort = 'name' | '-name' | 'quantity' | '-quantity' | '-createdAt';
export type StockFilter = 'in_stock' | 'low' | 'out' | 'attention';
export type MovementType = StockMovement['type'];

export interface ProductQuery {
  q?: string;
  stockStatus?: StockFilter;
  includeArchived?: boolean;
  sellable?: boolean;
  sort?: ProductSort;
  limit?: number;
}

export interface MovementQuery {
  productId?: string;
  types?: MovementType[];
  /** Instants (ISO 8601), already converted from business days in the organization time zone. */
  from?: string;
  to?: string;
  limit?: number;
}

export type ProductListMeta = PageMeta & { counts?: { all?: number; inStock?: number; low?: number; out?: number } };

export interface StockChange {
  movement: StockMovement;
  product: Product;
}

export interface ReceiveStock {
  productId: string;
  quantity: number;
  unitCostMinor: number;
  supplierName?: string | null;
  referenceNote?: string | null;
}

export interface AdjustStock {
  productId: string;
  quantityDelta: number;
  reason: string;
}

function params(values: Record<string, string | number | boolean | string[] | undefined | null>): HttpParams {
  let p = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    if (Array.isArray(value)) {
      if (value.length) p = p.set(key, value.join(','));
    } else {
      p = p.set(key, String(value));
    }
  }
  return p;
}

/**
 * Products and stock (docs/web-api-integration.md, inventory rows). Every successful change bumps
 * the entity counters so lists, details and the dashboard fetch again.
 */
@Injectable({ providedIn: 'root' })
export class InventoryApi {
  private readonly http = inject(HttpClient);
  private readonly versions = inject(EntityVersions);
  private readonly base = environment.apiBaseUrl;

  products(query: ProductQuery, cursor: string | null): Promise<Page<Product, ProductListMeta>> {
    return firstValueFrom(this.http.get<Page<Product, ProductListMeta>>(`${this.base}/products`, { params: params({ ...query, cursor }) }));
  }

  async product(id: string): Promise<Product> {
    return (await firstValueFrom(this.http.get<Envelope<Product>>(`${this.base}/products/${encodeURIComponent(id)}`))).data;
  }

  async create(body: ProductCreate, idempotencyKey: string): Promise<Product> {
    const res = await firstValueFrom(this.http.post<Envelope<Product>>(`${this.base}/products`, body, { headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }) }));
    this.versions.bump('products', 'stock');
    return res.data;
  }

  /** Optimistic locking: `body.version` must be the version that was edited (VERSION_CONFLICT otherwise). */
  async update(id: string, body: ProductUpdate): Promise<Product> {
    const res = await firstValueFrom(this.http.patch<Envelope<Product>>(`${this.base}/products/${encodeURIComponent(id)}`, body));
    this.versions.bump('products');
    return res.data;
  }

  async archive(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${this.base}/products/${encodeURIComponent(id)}`));
    this.versions.bump('products', 'stock');
  }

  async receive(body: ReceiveStock, idempotencyKey: string): Promise<StockChange> {
    const res = await firstValueFrom(
      this.http.post<Envelope<StockChange>>(`${this.base}/inventory/receipts`, body, { headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }) }),
    );
    this.versions.bump('products', 'stock');
    return res.data;
  }

  async adjust(body: AdjustStock, idempotencyKey: string): Promise<StockChange> {
    const res = await firstValueFrom(
      this.http.post<Envelope<StockChange>>(`${this.base}/inventory/adjustments`, body, { headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }) }),
    );
    this.versions.bump('products', 'stock');
    return res.data;
  }

  movements(query: MovementQuery, cursor: string | null): Promise<Page<StockMovement>> {
    const { types, ...rest } = query;
    return firstValueFrom(this.http.get<Page<StockMovement>>(`${this.base}/inventory/movements`, { params: params({ ...rest, type: types, cursor }) }));
  }
}
