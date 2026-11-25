import { HttpErrorResponse } from '@angular/common/http';

/**
 * Every failed request becomes one of these. The kinds and codes are the same as in the mobile
 * app (lib/core/api/failure.dart), so both apps word the same problem the same way.
 */
export type ApiFailure =
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'unauthorized'; code: string }
  | { kind: 'forbidden'; code: string }
  | { kind: 'notFound' }
  | { kind: 'rateLimited'; retryAfterSeconds: number }
  | { kind: 'validation'; fields: Record<string, string> }
  | { kind: 'business'; code: string; message: string | null; details: Record<string, unknown>[] }
  | { kind: 'server'; requestId: string | null }
  | { kind: 'unexpected' };

interface ErrorBody {
  error?: { code?: string; message?: string; requestId?: string; details?: unknown[] };
}

export function toApiFailure(error: unknown): ApiFailure {
  if (isApiFailure(error)) return error;
  if (error instanceof Error && error.name === 'TimeoutError') return { kind: 'timeout' };
  if (!(error instanceof HttpErrorResponse)) return { kind: 'unexpected' };
  // status 0: the request never got an answer (offline, DNS, CORS, aborted).
  if (error.status === 0) return { kind: 'network' };

  const body = (typeof error.error === 'object' && error.error !== null ? error.error : {}) as ErrorBody;
  const envelope = body.error ?? {};
  const code = envelope.code ?? '';
  const details = (Array.isArray(envelope.details) ? envelope.details : []).filter(
    (d): d is Record<string, unknown> => typeof d === 'object' && d !== null,
  );

  switch (error.status) {
    case 401:
      return { kind: 'unauthorized', code };
    case 403:
      return { kind: 'forbidden', code };
    case 404:
      return { kind: 'notFound' };
    case 429: {
      const retry = Number(error.headers.get('retry-after'));
      return { kind: 'rateLimited', retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : 60 };
    }
    case 400:
      return {
        kind: 'validation',
        fields: Object.fromEntries(
          details.filter((d) => typeof d['field'] === 'string').map((d) => [d['field'] as string, (d['rule'] as string | undefined) ?? 'invalid']),
        ),
      };
    case 409:
    case 422:
      return { kind: 'business', code, message: envelope.message ?? null, details };
  }
  if (error.status >= 500) return { kind: 'server', requestId: envelope.requestId ?? null };
  return { kind: 'unexpected' };
}

export function isApiFailure(value: unknown): value is ApiFailure {
  return typeof value === 'object' && value !== null && 'kind' in value && typeof (value as { kind: unknown }).kind === 'string' && !(value instanceof Error);
}
