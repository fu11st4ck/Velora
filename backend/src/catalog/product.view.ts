import type { MemberRole } from '@prisma/client';
import { canSeeCost } from '../authz/permissions';
import { priceFromMarkup } from '../common/money';

export type StockStatus = 'IN_STOCK' | 'LOW' | 'OUT';

/** Business rule S9. */
export function stockStatus(quantity: number, effectiveReorderLevel: number): StockStatus {
  if (quantity <= 0) return 'OUT';
  return quantity <= effectiveReorderLevel ? 'LOW' : 'IN_STOCK';
}

export interface ProductRecord {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  weightValue: { toString(): string } | null;
  weightUnit: 'G' | 'KG' | null;
  imageKey: string | null;
  costMinor: bigint;
  defaultMarkupBp: number;
  minMarkupBp: number;
  reorderLevel: number | null;
  isActive: boolean;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgPricing {
  lowStockThreshold: number;
  maxMarkupBp: number;
}

/**
 * The API representation of a product. This is the ONLY place a product is turned into a response,
 * so the confidentiality rule (P7) cannot be forgotten: without cost access the three policy
 * fields are not present at all — the role sees only list, floor and ceiling prices.
 */
export function productView(p: ProductRecord, quantity: number, org: OrgPricing, role: MemberRole) {
  const effectiveReorderLevel = p.reorderLevel ?? org.lowStockThreshold;
  const base = {
    id: p.id,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    description: p.description,
    weight: p.weightValue && p.weightUnit ? { value: trimDecimal(p.weightValue.toString()), unit: p.weightUnit } : null,
    // Product photos arrive with object storage (TASKS.md S2-02).
    imageUrl: null as string | null,
    quantity,
    stockStatus: stockStatus(quantity, effectiveReorderLevel),
    reorderLevel: p.reorderLevel,
    effectiveReorderLevel,
    listPriceMinor: priceFromMarkup(p.costMinor, p.defaultMarkupBp),
    floorPriceMinor: priceFromMarkup(p.costMinor, p.minMarkupBp),
    // A product whose default exceeds a later-lowered maximum keeps its own default as the ceiling.
    ceilingPriceMinor: priceFromMarkup(p.costMinor, Math.max(org.maxMarkupBp, p.defaultMarkupBp)),
    isActive: p.isActive,
    archivedAt: p.archivedAt,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
  if (!canSeeCost(role)) return base;
  return { ...base, costMinor: p.costMinor, defaultMarkupBp: p.defaultMarkupBp, minMarkupBp: p.minMarkupBp };
}

/** "12.800" → "12.8", "9.000" → "9". */
function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}
