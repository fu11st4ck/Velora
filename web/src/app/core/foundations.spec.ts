import { FormControl } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { endOfDay, formatDateTime, startOfDay, today } from './dates/dates';
import { parsePercent, percentInput, priceFromMarkup } from './money/pricing';
import { Submission } from './state/submission';
import { moneyValidator, percentValidator, wholeNumber } from '../shared/forms/validators';

describe('business days in a time zone', () => {
  it('turns calendar days into exact instants', () => {
    expect(startOfDay('2026-11-25', 'Asia/Dubai').toISOString()).toBe('2026-11-24T20:00:00.000Z');
    expect(endOfDay('2026-11-25', 'Asia/Dubai').toISOString()).toBe('2026-11-25T19:59:59.999Z');
    expect(startOfDay('2026-11-25', 'UTC').toISOString()).toBe('2026-11-25T00:00:00.000Z');
    // Across daylight-saving changes (London: GMT in winter, BST in summer).
    expect(startOfDay('2026-07-01', 'Europe/London').toISOString()).toBe('2026-06-30T23:00:00.000Z');
    expect(startOfDay('2026-03-29', 'Europe/London').toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(endOfDay('2026-03-29', 'Europe/London').toISOString()).toBe('2026-03-29T22:59:59.999Z'); // 23-hour day
    expect(endOfDay('2026-12-31', 'Asia/Kolkata').toISOString()).toBe('2026-12-31T18:29:59.999Z');
  });

  it('knows today and formats times in the business time zone', () => {
    expect(today('Asia/Dubai', new Date('2026-11-24T21:00:00Z'))).toBe('2026-11-25');
    expect(formatDateTime('2026-11-24T21:05:00Z', 'Asia/Dubai')).toBe('25 Nov 2026, 01:05');
  });
});

describe('price preview', () => {
  it('matches the server and mobile examples', () => {
    expect(priceFromMarkup(280000, 3000)).toBe(364000);
    expect(priceFromMarkup(280000, 1500)).toBe(322000);
    expect(priceFromMarkup(245000, 1500)).toBe(281750);
    expect(priceFromMarkup(100055, 3000)).toBe(130072); // 130071.5 rounds half up
    expect(priceFromMarkup(0, 3000)).toBe(0);
  });

  it('reads and writes percentages as basis points', () => {
    expect(parsePercent('30')).toBe(3000);
    expect(parsePercent('12.5')).toBe(1250);
    expect(parsePercent('12,05')).toBe(1205);
    for (const bad of ['', '-1', '1.234', 'abc', '12345']) expect(parsePercent(bad), bad).toBeNull();
    expect(percentInput(1250)).toBe('12.5');
    expect(percentInput(3000)).toBe('30');
    expect(percentInput(7)).toBe('0.07');
  });
});

describe('form validators', () => {
  const check = (validator: ReturnType<typeof moneyValidator>, value: string) => validator(new FormControl(value));
  it('money: integers via parseMoney, never floats', () => {
    const v = moneyValidator(() => 2, { required: true, min: 1 });
    expect(check(v, '')).toEqual({ required: true });
    expect(check(v, '1.234')).toEqual({ money: true });
    expect(check(v, '0')).toEqual({ min: { min: 1 } });
    expect(check(v, '2,800.50')).toBeNull();
  });
  it('percent and whole numbers', () => {
    const p = percentValidator({ required: true, max: () => 6000 });
    expect(p(new FormControl('61'))).toEqual({ maxPercent: { max: 6000 } });
    expect(p(new FormControl('60'))).toBeNull();
    const w = wholeNumber({ required: true, min: 1, max: 10 });
    expect(w(new FormControl('2.5'))).toEqual({ whole: true });
    expect(w(new FormControl('11'))).toEqual({ max: { max: 10 } });
    expect(w(new FormControl('3'))).toBeNull();
  });
});

describe('Submission', () => {
  const lost = new HttpErrorResponse({ status: 0 });
  const refused = new HttpErrorResponse({ status: 422, error: { error: { code: 'INSUFFICIENT_STOCK' } } });

  it('keeps the key after a lost answer and renews it after success or a refusal', async () => {
    const s = new Submission();
    const keys: string[] = [];
    await s.run(async (k) => { keys.push(k); throw lost; });
    expect(s.unconfirmed()).toBe(true);
    await s.run(async (k) => { keys.push(k); return 'ok'; });
    expect(keys[0]).toBe(keys[1]);
    await s.run(async (k) => { keys.push(k); throw refused; });
    expect(keys[2]).not.toBe(keys[1]);
    expect(s.failure()).toMatchObject({ kind: 'business', code: 'INSUFFICIENT_STOCK' });
    expect(s.unconfirmed()).toBe(false);
    await s.run(async (k) => { keys.push(k); return 'ok'; });
    expect(keys[3]).not.toBe(keys[2]);
  });

  it('ignores a second call while the first is in flight, and renews the key when the input changes', async () => {
    const s = new Submission();
    let release!: () => void;
    let calls = 0;
    const first = s.run(() => { calls++; return new Promise<void>((r) => (release = r)); });
    expect(await s.run(async () => { calls++; })).toBeUndefined();
    release();
    await first;
    expect(calls).toBe(1);
    const before = s.currentKey;
    s.inputChanged();
    expect(s.currentKey).not.toBe(before);
  });
});
