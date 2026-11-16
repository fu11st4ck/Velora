import { DomainError } from './errors';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** Opaque keyset cursor: the sort value(s) and id of the last row of the previous page. */
export function encodeCursor(parts: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}

export function decodeCursor(cursor: string, length: number): (string | number)[] {
  try {
    const parts: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parts) &&
      parts.length === length &&
      parts.every((p) => typeof p === 'string' || (typeof p === 'number' && Number.isFinite(p)))
    ) {
      return parts as (string | number)[];
    }
  } catch {
    // fall through
  }
  throw new DomainError('VALIDATION_ERROR', 400, 'The request is not valid.', [{ field: 'cursor', rule: 'invalid' }]);
}

/** Given `limit + 1` fetched rows, returns the page and whether more rows exist. */
export function takePage<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean } {
  return rows.length > limit ? { items: rows.slice(0, limit), hasMore: true } : { items: rows, hasMore: false };
}

/** Escapes LIKE wildcards so user input is always matched literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
