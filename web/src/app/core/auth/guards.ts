import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { type CanActivateFn, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { SessionStore } from './session.store';

/** Waits until the start-up session check has finished. */
async function settled(session: SessionStore): Promise<void> {
  if (session.status() !== 'unknown') return;
  await firstValueFrom(toObservable(session.status).pipe(filter((s) => s !== 'unknown')));
}

/** Routes behind sign-in. Unauthenticated visitors go to sign-in and come back afterwards. */
export const signedIn: CanActivateFn = async (_route, state) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  await settled(session);
  return session.status() === 'signedIn' ? true : router.createUrlTree(['/sign-in'], { queryParams: { returnUrl: state.url } });
};

/** Sign-in and forgot-password: a signed-in user goes to the dashboard instead. */
export const signedOut: CanActivateFn = async () => {
  // Everything injected before the first await: after it, there is no injection context.
  const session = inject(SessionStore);
  const router = inject(Router);
  await settled(session);
  return session.status() === 'signedIn' ? router.createUrlTree(['/dashboard']) : true;
};

/**
 * Routes that need a permission. The server enforces it regardless; this only avoids showing a
 * page whose every request would be refused.
 */
export const requires =
  (permission: string): CanActivateFn =>
  async () => {
    const session = inject(SessionStore);
    const router = inject(Router);
    await settled(session);
    return session.can(permission) ? true : router.createUrlTree(['/forbidden']);
  };
