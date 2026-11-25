/**
 * Money is held as integer minor units everywhere (business rule N1). These helpers format and
 * parse without floating point, with the same results as the mobile app's MoneyFormatter.
 */
export interface MoneyFormat {
  currencyCode: string;
  /** Number of decimal places of the currency (AED 2, JPY 0, KWD 3). */
  exponent: number;
  locale?: string;
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** `298095` → `AED 2,980.95`; negatives get a true minus sign. */
export function formatMoney(minor: number | bigint, f: MoneyFormat, options: { withCode?: boolean } = {}): string {
  if (f.exponent < 0 || f.exponent > 4) throw new RangeError('Currency exponent must be 0–4');
  const value = BigInt(minor);
  const abs = value < 0n ? -value : value;
  const scale = pow10(f.exponent);
  const parts = new Intl.NumberFormat(f.locale ?? 'en', { useGrouping: true }).formatToParts(1000.5);
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  // Group the whole part with Intl (it accepts bigint), then append the fraction ourselves.
  const whole = new Intl.NumberFormat(f.locale ?? 'en', { maximumFractionDigits: 0 }).format(abs / scale);
  const fraction = f.exponent === 0 ? '' : `${decimal}${(abs % scale).toString().padStart(f.exponent, '0')}`;
  const sign = value < 0n ? '−' : '';
  return options.withCode === false ? `${sign}${whole}${fraction}` : `${sign}${f.currencyCode} ${whole}${fraction}`;
}

/**
 * Reads typed input such as `2,980.95` into minor units. Returns null for anything that is not a
 * non-negative amount with at most the currency's number of decimals.
 */
export function parseMoney(input: string, f: Pick<MoneyFormat, 'exponent'>): number | null {
  const cleaned = input.trim().replace(/[\s,]/g, '');
  const match = /^(\d{1,12})(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > f.exponent) return null;
  const minor = BigInt(match[1]!) * pow10(f.exponent) + (fraction ? BigInt(fraction.padEnd(f.exponent, '0')) : 0n);
  return Number(minor); // ≤ 12 whole digits + 4 decimals stays far below 2^53
}

/** `3000` → `30%`, `1250` → `12.5%`, `-645` → `−6.45%`. */
export function formatBasisPoints(bp: number): string {
  const sign = bp < 0 ? '−' : '';
  const abs = Math.abs(Math.trunc(bp));
  const whole = Math.trunc(abs / 100);
  const fraction = abs % 100;
  if (fraction === 0) return `${sign}${whole}%`;
  return `${sign}${whole}.${fraction.toString().padStart(2, '0').replace(/0$/, '')}%`;
}
