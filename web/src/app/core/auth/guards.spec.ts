import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { type ActivatedRouteSnapshot, provideRouter, Router, type RouterStateSnapshot, UrlTree } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { meFixture } from '../../../testing/fixtures';
import { requires, signedIn, signedOut } from './guards';
import { SessionStore } from './session.store';

const route = {} as ActivatedRouteSnapshot;
const state = (url: string) => ({ url }) as RouterStateSnapshot;
const run = (guard: typeof signedIn, url = '/x') => TestBed.runInInjectionContext(() => guard(route, state(url))) as Promise<boolean | UrlTree>;
const url = (result: boolean | UrlTree) => (result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : result);

describe('route guards', () => {
  let session: SessionStore;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    session = TestBed.inject(SessionStore);
  });
  const become = (status: 'signedIn' | 'signedOut', role: 'MANAGER' | 'SALES' = 'MANAGER') =>
    patchState(unprotected(session), { status, me: status === 'signedIn' ? meFixture(role) : null });

  it('wait for the start-up session check before deciding', async () => {
    const pending = run(signedOut);
    become('signedIn');
    expect(url(await pending)).toBe('/dashboard');
  });

  it('send visitors to sign-in with the page they wanted', async () => {
    become('signedOut');
    expect(url(await run(signedIn, '/reports?from=2026-11-01'))).toBe('/sign-in?returnUrl=%2Freports%3Ffrom%3D2026-11-01');
    expect(await run(signedOut)).toBe(true);
  });

  it('let signed-in users through, and check permissions', async () => {
    become('signedIn', 'SALES');
    expect(await run(signedIn)).toBe(true);
    expect(await run(requires('sale.create'))).toBe(true);
    expect(url(await run(requires('settings.read')))).toBe('/forbidden');
  });
});
