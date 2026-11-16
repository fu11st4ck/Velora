/** Calendar-date helpers. Business dates are evaluated in the organization timezone (rule N5). */

/** `YYYY-MM-DD` for an instant, as seen in the given IANA timezone. */
export function localDate(instant: Date, timezone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A `YYYY-MM-DD` string as the Date value Prisma stores in a DATE column. */
export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** A DATE column value back to `YYYY-MM-DD`. */
export function fromDbDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** True for a real calendar date written as `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
