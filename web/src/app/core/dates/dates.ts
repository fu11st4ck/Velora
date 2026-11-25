/**
 * Dates are shown in the organization's time zone, not the browser's: a sale belongs to the
 * business's calendar day (business rule N5). Calendar dates (YYYY-MM-DD) have no time zone.
 */
export function formatInstant(iso: string, timeZone: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(iso));
}

export function formatCalendarDate(date: string, locale = 'en-GB'): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** "Good morning" etc. for the hour in the organization's time zone. */
export function greeting(now: Date, timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** Offset of `timeZone` from UTC, in minutes, at the given instant (e.g. +240 for Asia/Dubai). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a business day (YYYY-MM-DD) starts in the given time zone. */
export function startOfDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!);
  // Two passes settle the offset even when the guess falls on the other side of a DST change.
  let instant = new Date(guess - offsetMinutes(new Date(guess), timeZone) * 60_000);
  instant = new Date(guess - offsetMinutes(instant, timeZone) * 60_000);
  return instant;
}

/** The last millisecond of a business day in the given time zone. */
export function endOfDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
  return new Date(startOfDay(next, timeZone).getTime() - 1);
}

/** Today's date (YYYY-MM-DD) in the given time zone. */
export function today(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Date and time of an instant in the business time zone, e.g. "25 Nov 2026, 14:05". */
export function formatDateTime(iso: string, timeZone: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}
