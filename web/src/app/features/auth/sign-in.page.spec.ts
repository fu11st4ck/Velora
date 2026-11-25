import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { meFixture } from '../../../testing/fixtures';
import { apiInterceptor } from '../../core/api/api.interceptor';
import { BrowserSession } from '../../core/auth/browser-session';
import { SignInPage, safeReturnUrl } from './sign-in.page';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('safeReturnUrl', () => {
  it('follows same-site paths only', () => {
    expect(safeReturnUrl('/inventory?x=1')).toBe('/inventory?x=1');
    for (const bad of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      expect(safeReturnUrl(bad), String(bad)).toBe('/dashboard');
    }
  });
});

describe('SignInPage', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(withInterceptors([apiInterceptor])),
        provideHttpClientTesting(),
        { provide: BrowserSession, useValue: { exclusive: <T>(t: () => Promise<T>) => t(), post: () => undefined, listen: () => undefined, deviceName: () => 'Test' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    await TestBed.inject(Router).navigateByUrl('/sign-in?returnUrl=%2Freports');
  });

  function render() {
    const fixture = TestBed.createComponent(SignInPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = (id: string) => el.querySelector<HTMLInputElement & HTMLButtonElement>(`[data-testid="${id}"]`)!;
    const type = (id: string, value: string) => {
      q(id).value = value;
      q(id).dispatchEvent(new Event('input'));
    };
    return { fixture, el, q, type };
  }

  it('checks the fields before calling the server', async () => {
    const { fixture, el, q } = render();
    q('sign-in').click();
    await fixture.whenStable();
    expect(el.textContent).toContain('Enter your email address.');
    expect(el.textContent).toContain('Enter your password.');
    http.expectNone('/api/v1/auth/web/login');
  });

  it('shows the server refusal, clears the password, and keeps the email', async () => {
    const { fixture, q, type } = render();
    type('email', 'maya@velora.example');
    type('password', 'wrong');
    q('sign-in').click();
    http.expectOne('/api/v1/auth/web/login').flush({ error: { code: 'INVALID_CREDENTIALS' } }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    await fixture.whenStable();
    expect(q('sign-in-error').textContent).toContain('Email or password is incorrect.');
    expect(q('password').value).toBe('');
    expect(q('email').value).toBe('maya@velora.example');
  });

  it('explains a lock-out with the waiting time', async () => {
    const { fixture, q, type } = render();
    type('email', 'maya@velora.example');
    type('password', 'x');
    q('sign-in').click();
    http.expectOne('/api/v1/auth/web/login').flush({ error: { code: 'TOO_MANY_ATTEMPTS' } }, { status: 429, statusText: 'Too Many', headers: { 'retry-after': '840' } });
    await settle();
    await fixture.whenStable();
    expect(q('sign-in-error').textContent).toContain('Too many attempts. Try again in 14 minutes.');
  });

  it('signs in and returns to the page that was asked for', async () => {
    const { fixture, q, type } = render();
    const router = TestBed.inject(Router);
    type('email', 'maya@velora.example');
    type('password', 'right-password');
    q('sign-in').click();
    http.expectOne('/api/v1/auth/web/login').flush({ data: { accessToken: 'a1' } });
    await settle();
    http.expectOne('/api/v1/auth/me').flush({ data: meFixture() });
    await settle();
    await fixture.whenStable();
    expect(router.url).toBe('/reports');
  });
});
