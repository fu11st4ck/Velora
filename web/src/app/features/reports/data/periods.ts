import { addDays, today } from '../../../core/dates/dates';
import type { Period } from './reports.api';

export type Preset = 'today' | '7d' | 'month' | 'last-month' | 'custom';
export const MAX_DAYS = 366;

export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'custom', label: 'Custom' },
];

/** The business days a preset covers, counted in the organization's time zone. */
export function presetPeriod(preset: Exclude<Preset, 'custom'>, timeZone: string, now = new Date()): Period {
  const t = today(timeZone, now);
  const monthStart = `${t.slice(0, 7)}-01`;
  switch (preset) {
    case 'today':
      return { from: t, to: t };
    case '7d':
      return { from: addDays(t, -6), to: t };
    case 'month':
      return { from: monthStart, to: t };
    case 'last-month': {
      const lastDay = addDays(monthStart, -1);
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
    }
  }
}

/** Why a custom period cannot be used, or null. */
export function periodProblem(p: Period): string | null {
  if (p.from > p.to) return 'The start date is after the end date.';
  if (addDays(p.from, MAX_DAYS) < p.to) return `Choose at most ${MAX_DAYS} days.`;
  return null;
}
