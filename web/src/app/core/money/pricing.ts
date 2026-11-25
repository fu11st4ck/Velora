/**
 * Integer mirrors of the server's price rules (docs/business-rules.md P1), used ONLY for a preview
 * while someone types. The server computes and stores the real prices; screens show the server's
 * numbers once it has answered. Same examples as backend/src/common/money.ts and the mobile app.
 */
const BP = 10_000n;

function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/** Selling price for a cost and a markup on cost (basis points), rounded half up. */
export function priceFromMarkup(costMinor: number, markupBp: number): number {
  return Number(divRoundHalfUp(BigInt(costMinor) * (BP + BigInt(markupBp)), BP));
}

/** `30` or `12.5` → basis points; null when not a non-negative percentage with ≤ 2 decimals. */
export function parsePercent(input: string): number | null {
  const match = /^(\d{1,4})(?:[.,](\d{0,2}))?$/.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** `3000` → `30`, `1250` → `12.5` — for pre-filling a percentage field. */
export function percentInput(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = bp % 100;
  return fraction === 0 ? `${whole}` : `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
}
