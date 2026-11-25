import type { FastifyReply, FastifyRequest } from 'fastify';
import { Errors } from '../common/errors';
import type { AppConfig } from '../common/config';

/**
 * Browser sessions (docs/web-api-integration.md §2). The refresh token lives in this cookie:
 * HttpOnly (page scripts cannot read it), Secure, SameSite=Strict, and sent only to the three
 * /auth/web endpoints. Every other endpoint needs the Authorization header, which a cross-site
 * page cannot add, so the cookie alone never authorises anything but getting a new access token.
 */
export const REFRESH_COOKIE = '__Secure-velora_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth/web';
export const WEB_CLIENT_HEADER = 'x-velora-client';

/** Refuses a cookie-authenticated request unless it comes from the web app itself. */
export function assertFromWebApp(req: FastifyRequest, config: Pick<AppConfig, 'APP_BASE_URL'>): void {
  const origin = req.headers.origin;
  const allowed = new URL(config.APP_BASE_URL).origin;
  if (origin !== allowed || req.headers[WEB_CLIENT_HEADER] !== 'web') throw Errors.forbidden();
}

export function setRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  void reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  void reply.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: true, sameSite: 'strict', path: REFRESH_COOKIE_PATH });
}

export function refreshCookie(req: FastifyRequest): string | undefined {
  const value = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length >= 10 && value.length <= 200 ? value : undefined;
}
