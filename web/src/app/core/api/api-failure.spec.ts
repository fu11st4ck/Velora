import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { toApiFailure } from './api-failure';
import { describeFailure } from './messages';

const http = (status: number, error: unknown = null, headers = new HttpHeaders()) => new HttpErrorResponse({ status, error, headers });
const envelope = (code: string, details?: unknown[], requestId = 'req_1') => ({ error: { code, message: `server ${code}`, requestId, ...(details ? { details } : {}) } });

describe('toApiFailure', () => {
  it('maps each status to its kind, keeping the server code and details', () => {
    expect(toApiFailure(http(0))).toEqual({ kind: 'network' });
    expect(toApiFailure(http(401, envelope('INVALID_CREDENTIALS')))).toEqual({ kind: 'unauthorized', code: 'INVALID_CREDENTIALS' });
    expect(toApiFailure(http(403, envelope('ACCOUNT_DISABLED')))).toEqual({ kind: 'forbidden', code: 'ACCOUNT_DISABLED' });
    expect(toApiFailure(http(404, envelope('NOT_FOUND')))).toEqual({ kind: 'notFound' });
    expect(toApiFailure(http(400, envelope('VALIDATION_ERROR', [{ field: 'email', rule: 'isEmail' }, 'junk'])))).toEqual({ kind: 'validation', fields: { email: 'isEmail' } });
    expect(toApiFailure(http(422, envelope('INSUFFICIENT_STOCK', [{ available: 2 }])))).toEqual({
      kind: 'business', code: 'INSUFFICIENT_STOCK', message: 'server INSUFFICIENT_STOCK', details: [{ available: 2 }],
    });
    expect(toApiFailure(http(500, envelope('INTERNAL_ERROR')))).toEqual({ kind: 'server', requestId: 'req_1' });
    expect(toApiFailure(http(502, 'Bad gateway'))).toEqual({ kind: 'server', requestId: null });
    expect(toApiFailure(new Error('boom'))).toEqual({ kind: 'unexpected' });
  });

  it('reads Retry-After, defaulting to a minute', () => {
    expect(toApiFailure(http(429, envelope('RATE_LIMITED'), new HttpHeaders({ 'retry-after': '240' })))).toEqual({ kind: 'rateLimited', retryAfterSeconds: 240 });
    expect(toApiFailure(http(429))).toEqual({ kind: 'rateLimited', retryAfterSeconds: 60 });
  });
});

describe('describeFailure', () => {
  it('uses the same wording as the mobile app, quoting numbers where the server gave them', () => {
    expect(describeFailure({ kind: 'unauthorized', code: 'INVALID_CREDENTIALS' })).toBe('Email or password is incorrect.');
    expect(describeFailure({ kind: 'rateLimited', retryAfterSeconds: 240 })).toBe('Too many attempts. Try again in 4 minutes.');
    expect(describeFailure({ kind: 'business', code: 'INSUFFICIENT_STOCK', message: null, details: [{ available: 2 }] })).toBe('Only 2 in stock.');
    expect(describeFailure({ kind: 'business', code: 'WEAK_PASSWORD', message: null, details: [{ rule: 'too_common' }] })).toBe(
      'That password is too common. Choose something less predictable.',
    );
    expect(describeFailure({ kind: 'business', code: 'NEW_CODE', message: 'Server words.', details: [] })).toBe('Server words.');
    expect(describeFailure({ kind: 'server', requestId: 'req_9' })).toBe('Something went wrong on our side. Try again. (Ref req_9)');
  });
});
