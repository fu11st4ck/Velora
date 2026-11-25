import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BarList } from './components/bar-list';
import { StatusBar } from './components/status-bar';
import { periodProblem, presetPeriod } from './data/periods';

describe('report periods', () => {
  it('are business days in the organization time zone', () => {
    // 22:30 UTC on 30 Nov is already 1 Dec in Dubai (UTC+4).
    const now = new Date('2026-11-30T22:30:00Z');
    expect(presetPeriod('today', 'Asia/Dubai', now)).toEqual({ from: '2026-12-01', to: '2026-12-01' });
    expect(presetPeriod('today', 'UTC', now)).toEqual({ from: '2026-11-30', to: '2026-11-30' });
    expect(presetPeriod('7d', 'Asia/Dubai', now)).toEqual({ from: '2026-11-25', to: '2026-12-01' });
    expect(presetPeriod('month', 'Asia/Dubai', now)).toEqual({ from: '2026-12-01', to: '2026-12-01' });
    expect(presetPeriod('last-month', 'Asia/Dubai', now)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(presetPeriod('last-month', 'UTC', new Date('2026-03-15T00:00:00Z'))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetPeriod('last-month', 'UTC', new Date('2026-01-10T00:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('refuses reversed or too long custom periods (as the API does)', () => {
    expect(periodProblem({ from: '2026-11-02', to: '2026-11-01' })).toContain('after');
    // Same bound as backend/src/reports/reports.service.ts: `to` may be at most `from` + 366 days.
    expect(periodProblem({ from: '2025-01-01', to: '2026-01-03' })).toContain('366');
    expect(periodProblem({ from: '2025-01-01', to: '2026-01-02' })).toBeNull();
  });
});

describe('charts', () => {
  it('status bar draws nothing for a zero part, prints shares and names every part for assistive tech', async () => {
    const fixture = TestBed.createComponent(StatusBar);
    fixture.componentRef.setInput('description', 'Invoice value');
    fixture.componentRef.setInput('items', [
      { key: 'paid', label: 'Paid', color: 'green', ink: 'black', value: 300, detail: '3 invoices' },
      { key: 'partial', label: 'Partly paid', color: 'gold', ink: 'black', value: 100, detail: '1 invoice' },
      { key: 'unpaid', label: 'Unpaid', color: 'gray', ink: 'black', value: 0, detail: '0 invoices' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.block')).toHaveLength(2);
    expect(el.querySelector('[data-testid="status-bar"]')!.getAttribute('aria-label')).toBe('Invoice value: Paid 75%, Partly paid 25%');
    expect(el.querySelector('[data-testid="status-block-paid"]')!.textContent!.trim()).toBe('75%');
    (el.querySelector('[data-testid="status-block-partial"]') as HTMLElement).dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(el.querySelector('.tooltip')!.textContent).toContain('Partly paid · 25% · 1 invoice');
  });

  it('bar list scales bars to the largest value', async () => {
    const fixture = TestBed.createComponent(BarList);
    fixture.componentRef.setInput('items', [
      { key: 'a', label: 'A', value: 200, valueText: '200', detail: '' },
      { key: 'b', label: 'B', value: 50, valueText: '50', detail: '' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const widths = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.fill')].map((f) => f.style.width);
    expect(widths).toEqual(['100%', '25%']);
  });
});
