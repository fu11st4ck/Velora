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
