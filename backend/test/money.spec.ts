import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  applyRateBp,
  divRoundHalfUp,
  documentTotals,
  markupFromPrice,
  priceFromMarkup,
  weightedAverageCost,
} from '../src/common/money';

describe('rounding (N3)', () => {
  it('rounds half up', () => {
    expect(divRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divRoundHalfUp(4n, 10n)).toBe(0n);
    expect(divRoundHalfUp(15n, 10n)).toBe(2n);
    expect(divRoundHalfUp(14n, 10n)).toBe(1n);
    expect(divRoundHalfUp(0n, 7n)).toBe(0n);
  });
  it('rejects negative amounts and non-positive denominators', () => {
    expect(() => divRoundHalfUp(-1n, 2n)).toThrow(RangeError);
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });
});

describe('pricing (P1, P6)', () => {
  it('matches the reference catalogue: cost 2,800.00 at 30% is 3,640.00', () => {
    expect(priceFromMarkup(280000n, 3000)).toBe(364000n);
    expect(priceFromMarkup(620000n, 2000)).toBe(744000n);
    expect(priceFromMarkup(245000n, 2200)).toBe(298900n);
  });
  it('rounds a fractional price half up to the minor unit', () => {
    expect(priceFromMarkup(100055n, 3000)).toBe(130072n); // 1300.715 → 1300.72
    expect(priceFromMarkup(333n, 3333)).toBe(444n); // 443.9889 → 444
  });
  it('derives the markup a price represents, rounded down', () => {
    expect(markupFromPrice(280000n, 364000n)).toBe(3000);
    expect(markupFromPrice(280000n, 280000n)).toBe(0);
    expect(markupFromPrice(280000n, 100n)).toBe(0);
    expect(markupFromPrice(0n, 5000n)).toBe(0);
  });
  it('rejects fractional or negative rates', () => {
    expect(() => priceFromMarkup(100n, 12.5)).toThrow(RangeError);
    expect(() => applyRateBp(100n, -1)).toThrow(RangeError);
  });
});

describe('document totals (T1–T5)', () => {
  it("reproduces the reference's stored quotation: 2,989.00 − 150.00, VAT 5% → 141.95, total 2,980.95", () => {
    expect(documentTotals([298900n], 15000n, 500)).toEqual({
      subtotalMinor: 298900n,
      discountMinor: 15000n,
      taxableMinor: 283900n,
      taxMinor: 14195n,
      totalMinor: 298095n,
    });
  });
  it('rounds tax half up at the boundary', () => {
    expect(documentTotals([10n], 0n, 500).taxMinor).toBe(1n); // 0.5 → 1
    expect(documentTotals([9n], 0n, 500).taxMinor).toBe(0n); // 0.45 → 0
    expect(documentTotals([30n], 0n, 500).taxMinor).toBe(2n); // 1.5 → 2
  });
  it('supports a zero rate and a discount equal to the subtotal', () => {
    expect(documentTotals([5000n, 2500n], 0n, 0).totalMinor).toBe(7500n);
    expect(documentTotals([5000n], 5000n, 500)).toMatchObject({ taxMinor: 0n, totalMinor: 0n });
  });
  it('rejects a negative discount and a discount above the subtotal', () => {
    expect(() => documentTotals([5000n], -1n, 500)).toThrow('DISCOUNT_OUT_OF_RANGE');
    expect(() => documentTotals([5000n], 5001n, 500)).toThrow('DISCOUNT_OUT_OF_RANGE');
  });
  it('always satisfies total = subtotal − discount + tax', () => {
    const cart = fc.array(fc.bigInt({ min: 0n, max: 10n ** 12n }), { minLength: 1, maxLength: 30 });
    fc.assert(
      fc.property(cart, fc.integer({ min: 0, max: 10_000 }), fc.double({ min: 0, max: 1, noNaN: true }), (lines, rate, f) => {
        const subtotal = lines.reduce((a, b) => a + b, 0n);
        const discount = (subtotal * BigInt(Math.floor(f * 1000))) / 1000n;
        const t = documentTotals(lines, discount, rate);
        expect(t.totalMinor).toBe(t.subtotalMinor - t.discountMinor + t.taxMinor);
        expect(t.taxMinor <= t.taxableMinor).toBe(true);
      }),
    );
  });
});

describe('allocation (T6)', () => {
  it('splits by largest remainder and sums exactly', () => {
    expect(allocateProportionally(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocateProportionally(15000n, [364000n, 597800n])).toEqual([5677n, 9323n]);
    expect(allocateProportionally(0n, [5n, 5n])).toEqual([0n, 0n]);
    expect(allocateProportionally(0n, [])).toEqual([]);
  });
  it('refuses to allocate money across nothing', () => {
    expect(() => allocateProportionally(1n, [])).toThrow(RangeError);
    expect(() => allocateProportionally(1n, [0n, 0n])).toThrow(RangeError);
  });
  it('parts always sum to the total and never exceed a proportional share by more than one unit', () => {
    const weights = fc.array(fc.bigInt({ min: 0n, max: 10n ** 10n }), { minLength: 1, maxLength: 40 });
    fc.assert(
      fc.property(weights, fc.bigInt({ min: 0n, max: 10n ** 12n }), (w, total) => {
        const sum = w.reduce((a, b) => a + b, 0n);
        fc.pre(sum > 0n);
        const parts = allocateProportionally(total, w);
        expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
        parts.forEach((p, i) => {
          const floor = (total * (w[i] as bigint)) / sum;
          expect(p === floor || p === floor + 1n).toBe(true);
        });
      }),
    );
  });
});

describe('weighted average cost (S5)', () => {
  it('uses the receipt cost when nothing is on hand', () => {
    expect(weightedAverageCost(0, 999n, 10, 280000n)).toBe(280000n);
  });
  it('averages by quantity and rounds half up', () => {
    expect(weightedAverageCost(24, 280000n, 10, 290000n)).toBe(282941n); // 2829.4117… → 2829.41
    expect(weightedAverageCost(1, 100n, 1, 101n)).toBe(101n); // 100.5 → 101
  });
  it('rejects non-positive receipts and fractional quantities', () => {
    expect(() => weightedAverageCost(1, 1n, 0, 1n)).toThrow(RangeError);
    expect(() => weightedAverageCost(1.5, 1n, 1, 1n)).toThrow(RangeError);
  });
});
