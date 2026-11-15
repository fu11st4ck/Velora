import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';

/** A handler may return this to supply list metadata alongside the data. */
export class Page<T> {
  constructor(
    readonly data: T[],
    readonly meta: Record<string, unknown>,
  ) {}
}

/** Wraps successful JSON responses as `{ data }` or `{ data, meta }`. BigInt money is emitted as a JSON integer. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        if (value === undefined || value instanceof StreamableFile) return value;
        if (value instanceof Page) return toJsonSafe({ data: value.data, meta: value.meta });
        return toJsonSafe({ data: value });
      }),
    );
  }
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Converts bigint to number (guarding precision) and Date to ISO strings, recursively. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value > MAX_SAFE || value < -MAX_SAFE) throw new Error('Amount exceeds the JSON-safe integer range');
    return Number(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}
