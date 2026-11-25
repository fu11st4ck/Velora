import { HttpErrorResponse, type HttpEvent, type HttpHandlerFn, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, type Observable, switchMap, throwError, timer, timeout, retry, catchError } from 'rxjs';
import { SessionStore } from '../auth/session.store';
import { SKIP_AUTH, TIMEOUT_MS } from './http-context';

const RETRYABLE = new Set([0, 502, 503, 504]);

/**
 * Every API request passes through here:
 * - adds the in-memory access token;
 * - on 401, refreshes once (single flight, see SessionStore) and replays the request; if the
 *   server refuses the session, signs out locally with "session ended"; if the refresh cannot reach
 *   the server, the request fails with that failure and the person stays signed in;
 * - retries a GET once after 1 s on a network error or gateway error (never a write);
 * - abandons requests after a timeout.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionStore);
  const limit = req.context.get(TIMEOUT_MS);
  const send = (request: HttpRequest<unknown>): Observable<HttpEvent<unknown>> => {
    let call = next(request).pipe(timeout({ first: limit }));
    if (request.method === 'GET') {
      call = call.pipe(retry({ count: 1, delay: (error) => (error instanceof HttpErrorResponse && RETRYABLE.has(error.status) ? timer(1000) : throwError(() => error)) }));
    }
    return call;
  };

  if (req.context.get(SKIP_AUTH)) return send(req);
  const withToken = (token: string | null) => (token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);

  return send(withToken(session.accessToken())).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) return throwError(() => error);
      return from(session.refreshAccessToken()).pipe(
        switchMap((token) => {
          if (!token) {
            session.expire();
            return throwError(() => error);
          }
          return send(withToken(token)).pipe(
            catchError((again: unknown) => {
              if (again instanceof HttpErrorResponse && again.status === 401) session.expire();
              return throwError(() => again);
            }),
          );
        }),
      );
    }),
  );
};

export type { HttpHandlerFn };
