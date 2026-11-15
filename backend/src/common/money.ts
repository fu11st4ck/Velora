/**
 * Money arithmetic on integer minor units (docs/business-rules.md §1).
 * Everything here is exact bigint arithmetic; rounding is half-up and happens only where stated.
 */

const BP = 10_000n;

function assertNonNegative(...values: bigint[]): void {
  for (const v of values) if (v < 0n) throw new RangeError('Expected a non-negative amount');
}

/** N3: round_half_up(numerator / denominator) for non-negative operands. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Denominator must be positive');
  assertNonNegative(numerator);
  return (2n * numerator + denominator) / (2n * denominator);
}

/** amount × rate (basis points), rounded half up. Used for tax (T4). */
export function applyRateBp(amountMinor: bigint, rateBp: number): bigint {
  assertRate(rateBp);
  return divRoundHalfUp(amountMinor * BigInt(rateBp), BP);
}

/** P1: selling price for a cost and a markup on cost. */
export function priceFromMarkup(costMinor: bigint, markupBp: number): bigint {
  assertRate(markupBp);
  return divRoundHalfUp(costMinor * (BP + BigInt(markupBp)), BP);
}

/** P6: the markup a given price represents, rounded down; 0 when cost is 0 or the price is below cost. */
export function markupFromPrice(costMinor: bigint, unitPriceMinor: bigint): number {
  assertNonNegative(costMinor, unitPriceMinor);
  if (costMinor === 0n || unitPriceMinor <= costMinor) return 0;
  return Number(((unitPriceMinor - costMinor) * BP) / costMinor);
}

/**
 * T6: split `total` across parts in proportion to `weights` using the largest-remainder method,
 * so the parts always sum exactly to `total`. Ties go to the earlier line.
 */
export function allocateProportionally(total: bigint, weights: readonly bigint[]): bigint[] {
  assertNonNegative(total, ...weights);
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  if (weights.length === 0) {
    if (total !== 0n) throw new RangeError('Cannot allocate a non-zero amount across no lines');
    return [];
  }
  if (weightSum === 0n) {
    if (total !== 0n) throw new RangeError('Cannot allocate a non-zero amount across zero weights');
    return weights.map(() => 0n);
  }
  const shares = weights.map((w) => (total * w) / weightSum);
  const remainders = weights.map((w, i) => ({ i, r: (total * w) % weightSum }));
  let left = total - shares.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    shares[i] = (shares[i] as bigint) + 1n;
    left -= 1n;
  }
  return shares;
}

/** S5: moving weighted average cost after receiving stock. */
export function weightedAverageCost(
  onHand: number,
  currentCostMinor: bigint,
  received: number,
  receivedUnitCostMinor: bigint,
): bigint {
  if (!Number.isInteger(onHand) || !Number.isInteger(received) || onHand < 0 || received <= 0) {
    throw new RangeError('Quantities must be whole numbers; received must be positive');
  }
  assertNonNegative(currentCostMinor, receivedUnitCostMinor);
  if (onHand === 0) return receivedUnitCostMinor;
  const totalValue = BigInt(onHand) * currentCostMinor + BigInt(received) * receivedUnitCostMinor;
  return divRoundHalfUp(totalValue, BigInt(onHand + received));
}

export interface DocumentTotals {
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxableMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

/** T1–T5 for a set of line totals. Throws when the discount is outside 0…subtotal (T3). */
export function documentTotals(lineTotalsMinor: readonly bigint[], discountMinor: bigint, taxRateBp: number): DocumentTotals {
  assertNonNegative(...lineTotalsMinor);
  const subtotalMinor = lineTotalsMinor.reduce((a, b) => a + b, 0n);
  if (discountMinor < 0n || discountMinor > subtotalMinor) throw new RangeError('DISCOUNT_OUT_OF_RANGE');
  const taxableMinor = subtotalMinor - discountMinor;
  const taxMinor = applyRateBp(taxableMinor, taxRateBp);
  return { subtotalMinor, discountMinor, taxableMinor, taxMinor, totalMinor: taxableMinor + taxMinor };
}

function assertRate(rateBp: number): void {
  if (!Number.isInteger(rateBp) || rateBp < 0) throw new RangeError('Rate must be a non-negative whole number of basis points');
}
