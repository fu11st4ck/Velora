import type { components } from './schema';

/** Shapes of API payloads, from the generated contract (src/app/core/api/schema.d.ts). */
export type Schemas = components['schemas'];
export type Me = Schemas['Me'];
export type WebSession = Schemas['WebSession'];
export type DashboardSummary = Schemas['DashboardSummary'];
export type DocumentSummary = Schemas['DocumentSummary'];
export type Role = Schemas['Role'];

/** The `{ data }` envelope every successful JSON response uses. */
export interface Envelope<T> {
  data: T;
}
export type Product = Schemas['Product'];
export type ProductCreate = Schemas['ProductCreate'];
export type ProductUpdate = Schemas['ProductUpdate'];
export type StockMovement = Schemas['StockMovement'];
export type PageMeta = Schemas['PageMeta'];

/** A page of a list endpoint: `{ data: [...], meta: { nextCursor, hasMore } }`. */
export interface Page<T, M extends PageMeta = PageMeta> {
  data: T[];
  meta: M;
}
export type Customer = Schemas['Customer'];
export type CustomerDetail = Schemas['CustomerDetail'];
export type CustomerInput = Schemas['CustomerInput'];
export type TaxRate = Schemas['TaxRate'];
export type PricingPreview = Schemas['PricingPreview'];
export type Invoice = Schemas['Invoice'];
export type Quotation = Schemas['Quotation'];
export type Payment = Schemas['Payment'];
export type SalesReturn = Schemas['SalesReturn'];
export type Member = Schemas['Member'];
