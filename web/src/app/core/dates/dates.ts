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
