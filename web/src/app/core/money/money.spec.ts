import { describe, expect, it } from 'vitest';
import { formatBasisPoints, formatMoney, parseMoney } from './money';

// The same cases as the mobile app's money_format_test.dart, so both apps show identical amounts.
const aed = { currencyCode: 'AED', exponent: 2 };

describe('formatMoney', () => {
  it('always shows the currency decimals, so documents visibly add up', () => {
    expect(formatMoney(298095, aed)).toBe('AED 2,980.95');
    expect(formatMoney(14195, aed)).toBe('AED 141.95');
    expect(formatMoney(364000, aed)).toBe('AED 3,640.00');
    expect(formatMoney(5, aed)).toBe('AED 0.05');
    expect(formatMoney(0, aed)).toBe('AED 0.00');
  });

  it('groups thousands and marks negatives with a minus sign', () => {
    expect(formatMoney(15085000000, aed)).toBe('AED 150,850,000.00');
    expect(formatMoney(-15000, aed)).toBe('−AED 150.00');
  });

  it('respects currencies with other minor units', () => {
    expect(formatMoney(1234, { currencyCode: 'JPY', exponent: 0 })).toBe('JPY 1,234');
    expect(formatMoney(1234567, { currencyCode: 'KWD', exponent: 3 })).toBe('KWD 1,234.567');
  });

  it('can omit the currency code, and stays exact beyond the floating-point range', () => {
    expect(formatMoney(298095, aed, { withCode: false })).toBe('2,980.95');
    expect(formatMoney(9007199254740993n, aed)).toBe('AED 90,071,992,547,409.93');
  });
});

describe('parseMoney', () => {
  it('reads typed amounts into minor units without floating point', () => {
    expect(parseMoney('2980.95', aed)).toBe(298095);
    expect(parseMoney('2,980.95', aed)).toBe(298095);
    expect(parseMoney(' 100 ', aed)).toBe(10000);
    expect(parseMoney('0.1', aed)).toBe(10);
    expect(parseMoney('1000.55', aed)).toBe(100055);
    expect(parseMoney('19.99', aed)).toBe(1999); // 19.99 * 100 is 1998.9999… in floating point
    expect(parseMoney('5.', aed)).toBe(500);
  });

  it('rejects negatives, text and too many decimal places', () => {
    for (const bad of ['-5', 'abc', '', '1.234', '1.2.3']) expect(parseMoney(bad, aed), bad).toBeNull();
    expect(parseMoney('1.5', { exponent: 0 })).toBeNull();
  });
});

describe('formatBasisPoints', () => {
  it('formats basis points as a percentage', () => {
    expect(formatBasisPoints(3000)).toBe('30%');
    expect(formatBasisPoints(500)).toBe('5%');
    expect(formatBasisPoints(1250)).toBe('12.5%');
    expect(formatBasisPoints(1667)).toBe('16.67%');
    expect(formatBasisPoints(5)).toBe('0.05%');
    expect(formatBasisPoints(0)).toBe('0%');
    expect(formatBasisPoints(-645)).toBe('−6.45%');
  });
});
