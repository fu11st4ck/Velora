import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from './errors';

interface ErrorBody {
  error: { code: string; message: string; details?: ReadonlyArray<Record<string, unknown>>; requestId: string };
}

const HTTP_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'TOKEN_INVALID',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'VALIDATION_ERROR',
  415: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
};

/** Converts every failure into the single error envelope. Nothing internal is ever returned. */
@Catch()
export class GlobalErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const requestId = String(req.id);

    let status = 500;
    let body: ErrorBody = {
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId },
    };

    if (exception instanceof DomainError) {
      status = exception.status;
      body = { error: { code: exception.code, message: exception.message, details: exception.details, requestId } };
      for (const [k, v] of Object.entries(exception.headers ?? {})) void reply.header(k, v);
    } else if (uniqueViolation(exception)) {
      // Two requests raced past the friendly pre-check; the database constraint decided.
      const target = uniqueViolation(exception) as string;
      const code = target.includes('barcode') ? 'BARCODE_TAKEN' : target.includes('sku') ? 'SKU_TAKEN' : 'INVALID_STATE';
      status = 409;
      body = { error: { code, message: 'This value is already in use.', requestId } };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const details =
        typeof res === 'object' && res !== null && Array.isArray((res as { details?: unknown }).details)
          ? ((res as { details: Record<string, unknown>[] }).details)
          : undefined;
      const message =
        status === 400 ? 'The request is not valid.' : status === 404 ? 'Resource not found.' : exception.message;
      body = { error: { code: HTTP_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR'), message, details, requestId } };
    } else if (isFastifyClientError(exception)) {
      // Malformed JSON, payload too large, rate limit plugin, etc.
      status = exception.statusCode;
      body = {
        error: {
          code: HTTP_CODES[status] ?? 'VALIDATION_ERROR',
          message: status === 429 ? 'Too many requests. Try again shortly.' : 'The request is not valid.',
          requestId,
        },
      };
    }

    if (status >= 500) {
      this.logger.error({ requestId, method: req.method, url: req.url, err: exception }, 'Unhandled error');
    } else {
      this.logger.debug({ requestId, method: req.method, url: req.url, code: body.error.code }, 'Request rejected');
    }
    void reply.status(status).header('X-Request-Id', requestId).send(body);
  }
}

function isFastifyClientError(e: unknown): e is { statusCode: number } {
  const code = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === 'number' && code >= 400 && code < 500;
}

/** Returns the constraint/columns of a PostgreSQL unique violation surfaced by Prisma, else null. */
function uniqueViolation(e: unknown): string | null {
  const err = e as { code?: string; meta?: { target?: unknown; message?: unknown; code?: unknown }; message?: string } | null;
  if (err?.code === 'P2002') return JSON.stringify(err.meta?.target ?? err.message ?? '').toLowerCase() || 'unknown';
  if (err?.code === 'P2010' && err.meta?.code === '23505') return String(err.meta?.message ?? '').toLowerCase() || 'unknown';
  return null;
}
