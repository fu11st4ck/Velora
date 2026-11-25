import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import type { Me } from '../api/types';
import { toApiFailure, type ApiFailure } from '../api/api-failure';
import type { MoneyFormat } from '../money/money';
import { clearSavedSales } from '../state/saved-sale';
import { AuthApi } from './auth.api';
import { BrowserSession } from './browser-session';

export type SessionStatus = 'unknown' | 'signedIn' | 'signedOut';
/** Why the session ended, shown on the sign-in page. */
export type EndReason = 'expired' | 'signedOut' | 'unreachable' | null;

/** Failures that say nothing about the session itself: the request may simply be tried again. */
function isTransient(f: ApiFailure): boolean {
  return f.kind === 'network' || f.kind === 'timeout' || f.kind === 'server' || f.kind === 'rateLimited';
}

const RESTORE_ATTEMPTS = 3;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface SessionState {
  status: SessionStatus;
  me: Me | null;
  /** In memory only — never written to any browser storage. */
  accessToken: string | null;
  endReason: EndReason;
}

const initial: SessionState = { status: 'unknown', me: null, accessToken: null, endReason: null };

/**
 * The signed-in user and their access token (docs/web-state-management.md §4).
 * The refresh token is an HttpOnly cookie this code never sees.
 */
export const SessionStore = signalStore(
  { providedIn: 'root' },
  withState(initial),
  withComputed(({ me }) => ({
    permissions: computed(() => new Set(me()?.permissions ?? [])),
    role: computed(() => me()?.membership.role ?? null),
    money: computed<MoneyFormat>(() => ({
      currencyCode: me()?.settings.currencyCode ?? '',
      exponent: me()?.settings.currencyExponent ?? 2,
      locale: me()?.settings.locale ?? 'en',
    })),
  })),
  withMethods((store, api = inject(AuthApi), browser = inject(BrowserSession)) => {
    let inflight: Promise<string | null> | null = null;

    const establish = async (accessToken: string) => {
      const me = await api.me(accessToken);
      patchState(store, { status: 'signedIn', me, accessToken, endReason: null });
    };
    const end = (endReason: EndReason) => patchState(store, { ...initial, status: 'signedOut', endReason });

    /**
     * One refresh at a time in this tab, and across tabs via a Web Lock. Resolves to the new access
     * token, or null when the server refuses the session (it ended). A failure that says nothing
     * about the session — no connection, timeout, server error — is thrown as an ApiFailure, so the
     * request in hand fails but the person stays signed in.
     */
    const refresh = (): Promise<string | null> =>
      (inflight ??= browser
        .exclusive(async () => {
          try {
            const { accessToken } = await api.refresh();
            patchState(store, { accessToken });
            return accessToken;
          } catch (error) {
            const failure = toApiFailure(error);
            if (isTransient(failure)) throw failure;
            return null;
          }
        })
        .finally(() => (inflight = null)));

    return {
      can: (permission: string) => store.permissions().has(permission),

      /** At start-up: the refresh cookie, if any, restores the session silently. */
      async restore(): Promise<void> {
        // A server that cannot be reached for a moment must not look like a sign-out: try again a
        // few times, then explain. The cookie is untouched, so a reload later restores the session.
        const attempt = async (n: number): Promise<string | null | undefined> => {
          try {
            return await refresh();
          } catch {
            if (n >= RESTORE_ATTEMPTS) return undefined; // still unreachable
            await pause(500 * 2 ** (n - 1));
            return attempt(n + 1);
          }
        };
        const token = await attempt(1);
        if (token === undefined) return end('unreachable');
        if (!token) return end(null);
        try {
          await establish(token);
        } catch (error) {
          end(isTransient(toApiFailure(error)) ? 'unreachable' : null);
        }
      },

      /** Throws an ApiFailure so the sign-in form can show it. */
      async signIn(email: string, password: string): Promise<void> {
        try {
          const session = await api.signIn(email.trim(), password, browser.deviceName());
          await establish(session.accessToken);
          browser.post({ type: 'signed-in' });
        } catch (error) {
          throw toApiFailure(error) satisfies ApiFailure;
        }
      },

      async signOut(): Promise<void> {
        try {
          await api.signOut();
        } catch {
          // The session is ended locally regardless; the cookie expires server-side if this failed.
        }
        // An expired session keeps the sale in progress (sign in again and carry on); signing out does not.
        clearSavedSales();
        end('signedOut');
        browser.post({ type: 'signed-out' });
      },

      /** For the HTTP layer: a fresh access token, null when the session ended; throws when the server cannot be reached. */
      refreshAccessToken: refresh,

      /** The server refused the session: back to sign-in, explaining why. */
      expire(): void {
        if (store.status() === 'signedIn') end('expired');
      },

      /** After settings change: reload the profile (currency, default tax…). */
      async reloadProfile(): Promise<void> {
        const token = store.accessToken();
        if (token) await establish(token).catch(() => undefined);
      },

      /** Messages from other tabs. */
      onBrowserMessage(type: 'signed-out' | 'signed-in'): void {
        if (type === 'signed-out' && store.status() === 'signedIn') end('signedOut');
        if (type === 'signed-in' && store.status() === 'signedOut') void this.restore();
      },
    };
  }),
  withHooks({
    onInit(store, browser = inject(BrowserSession)) {
      browser.listen((message) => store.onBrowserMessage(message.type));
    },
  }),
);
export type SessionStore = InstanceType<typeof SessionStore>;
