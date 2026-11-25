import type { Product } from '../../../core/api/types';
import type { Tone } from '../../../shared/ui/status-pill';
import type { MovementType } from './inventory.api';

/** Stock status as the server classified it (business rule S9) — never recomputed here. */
export function stockLabel(p: Pick<Product, 'stockStatus' | 'archivedAt'>): { label: string; tone: Tone } {
  if (p.archivedAt) return { label: 'Archived', tone: 'neutral' };
  switch (p.stockStatus) {
    case 'OUT':
      return { label: 'Out of stock', tone: 'danger' };
    case 'LOW':
      return { label: 'Low stock', tone: 'warning' };
    default:
      return { label: 'In stock', tone: 'success' };
  }
}

export const MOVEMENT_TYPES: { value: MovementType; label: string }[] = [
  { value: 'OPENING', label: 'Opening stock' },
  { value: 'PURCHASE_RECEIPT', label: 'Received' },
  { value: 'SALE', label: 'Sale' },
  { value: 'SALE_CANCELLATION', label: 'Sale cancelled' },
  { value: 'CUSTOMER_RETURN', label: 'Customer return' },
  { value: 'ADJUSTMENT_IN', label: 'Adjustment in' },
  { value: 'ADJUSTMENT_OUT', label: 'Adjustment out' },
];

export function movementLabel(type: MovementType): string {
  return MOVEMENT_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function weightLabel(weight: Product['weight']): string {
  return weight ? `${weight.value} ${weight.unit === 'KG' ? 'kg' : 'g'}` : '';
}

/** Signed quantity for the ledger: "+5", "−2". */
export function signedQuantity(delta: number): string {
  return delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0';
}

/** Value at cost of the units on hand: quantity × weighted-average cost, in integer minor units. */
export function valueAtCost(p: Pick<Product, 'quantity' | 'costMinor'>): number | null {
  if (p.costMinor === undefined || p.costMinor === null) return null;
  return Number(BigInt(p.quantity) * BigInt(p.costMinor));
}
