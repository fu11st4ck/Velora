import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meFixture } from '../../../testing/fixtures';
import { apiInterceptor } from '../api/api.interceptor';
import { BrowserSession, type SessionMessage } from './browser-session';
import { SessionStore } from './session.store';

/** Browser facilities replaced by a recorder; the lock runs tasks one after another like Web Locks. */
class FakeBrowser {
  posted: SessionMessage[] = [];
  handler: ((m: SessionMessage) => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task);
    this.chain = run.catch(() => undefined);
    return run;
  }
  post(m: SessionMessage) { this.posted.push(m); }
  listen(h: (m: SessionMessage) => void) { this.handler = h; }
  deviceName() { return 'Chrome on macOS'; }
}

describe('session and API interceptor', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let browser: FakeBrowser;
  const api = '/api/v1';
  const flushMe = (token: string) => {
    const req = http.expectOne(`${api}/auth/me`);
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${token}`);
    req.flush({ data: meFixture() });
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    browser = new FakeBrowser();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(), { provide: BrowserSession, useValue: browser }],
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
  });
  afterEach(() => http.verify());

  async function signIn(token = 'access-1') {
    const done = session.signIn(' maya@velora.example ', 'pw');
    const login = http.expectOne(`${api}/auth/web/login`);
    expect(login.request.headers.get('X-Velora-Client')).toBe('web');
    expect(login.request.headers.has('Authorization')).toBe(false);
    expect(login.request.body).toEqual({ email: 'maya@velora.example', password: 'pw', deviceName: 'Chrome on macOS' });
    login.flush({ data: { accessToken: token } });
    await settle();
    flushMe(token);
    await done;
  }

  it('restores a session from the refresh cookie at start-up', async () => {
    const done = session.restore();
    await settle();
    http.expectOne(`${api}/auth/web/refresh`).flush({ data: { accessToken: 'access-r' } });
    await settle();
    flushMe('access-r');
    await done;
    expect(session.status()).toBe('signedIn');
    expect(session.can('report.read_all')).toBe(true);
    expect(session.money()).toEqual({ currencyCode: 'AED', exponent: 2, locale: 'en' });
  });

  it('starts signed out when there is no valid cookie', async () => {
    const done = session.restore();
    await settle();
    http.expectOne(`${api}/auth/web/refresh`).flush({ error: { code: 'SESSION_REVOKED' } }, { status: 401, statusText: 'Unauthorized' });
    await done;
    expect(session.status()).toBe('signedOut');
    expect(session.endReason()).toBeNull();
  });

  it('signs in, tells other tabs, and keeps the token only in memory', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await signIn();
    expect(session.status()).toBe('signedIn');
    expect(session.accessToken()).toBe('access-1');
    expect(browser.posted).toEqual([{ type: 'signed-in' }]);
    expect(setItem.mock.calls.flat().join(' ')).not.toContain('access-1');
  });

  it('reports a failed sign-in as a typed failure', async () => {
    const done = session.signIn('maya@velora.example', 'wrong');
    http.expectOne(`${api}/auth/web/login`).flush({ error: { code: 'INVALID_CREDENTIALS' } }, { status: 401, statusText: 'Unauthorized' });
    await expect(done).rejects.toEqual({ kind: 'unauthorized', code: 'INVALID_CREDENTIALS' });
    expect(session.status()).not.toBe('signedIn');
  });

  it('adds the access token; on 401 refreshes once and replays the request', async () => {
    await signIn('old');
    const result = firstValueFrom(TestBed.inject(HttpClient).get(`${api}/products`));
    const first = http.expectOne(`${api}/products`);
    expect(first.request.headers.get('Authorization')).toBe('Bearer old');
    first.flush({ error: { code: 'TOKEN_EXPIRED' } }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    http.expectOne(`${api}/auth/web/refresh`).flush({ data: { accessToken: 'new' } });
    await settle();
    const replay = http.expectOne(`${api}/products`);
    expect(replay.request.headers.get('Authorization')).toBe('Bearer new');
    replay.flush({ data: [] });
    expect(await result).toEqual({ data: [] });
  });

  it('refreshes only once when several requests fail together', async () => {
    await signIn('old');
    const client = TestBed.inject(HttpClient);
    const a = firstValueFrom(client.get(`${api}/a`));
    const b = firstValueFrom(client.get(`${api}/b`));
    for (const url of ['a', 'b']) http.expectOne(`${api}/${url}`).flush(null, { status: 401, statusText: 'Unauthorized' });
    await settle();
    http.expectOne(`${api}/auth/web/refresh`).flush({ data: { accessToken: 'new' } }); // exactly one
    await settle();
    for (const url of ['a', 'b']) http.expectOne(`${api}/${url}`).flush({ data: url });
    expect([await a, await b]).toEqual([{ data: 'a' }, { data: 'b' }]);
  });

  it('ends the session with "expired" when the refresh is refused', async () => {
    await signIn();
    const result = firstValueFrom(TestBed.inject(HttpClient).get(`${api}/products`));
    http.expectOne(`${api}/products`).flush(null, { status: 401, statusText: 'Unauthorized' });
    await settle();
    http.expectOne(`${api}/auth/web/refresh`).flush(null, { status: 401, statusText: 'Unauthorized' });
    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(session.status()).toBe('signedOut');
    expect(session.endReason()).toBe('expired');
    expect(session.accessToken()).toBeNull();
  });

  it('retries a GET once after a gateway error, but never a write', async () => {
    vi.useFakeTimers();
    try {
      const client = TestBed.inject(HttpClient);
      const read = firstValueFrom(client.get(`${api}/health/ready`));
      http.expectOne(`${api}/health/ready`).flush(null, { status: 503, statusText: 'Unavailable' });
      await vi.advanceTimersByTimeAsync(1000);
      http.expectOne(`${api}/health/ready`).flush({ data: { status: 'ok' } });
      expect(await read).toEqual({ data: { status: 'ok' } });

      const write = firstValueFrom(client.post(`${api}/invoices`, {}));
      http.expectOne(`${api}/invoices`).flush(null, { status: 503, statusText: 'Unavailable' });
      await expect(write).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(2000);
      http.expectNone(`${api}/invoices`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('signs out on the server and in every tab; follows other tabs', async () => {
    await signIn();
    const done = session.signOut();
    http.expectOne(`${api}/auth/web/logout`).flush(null, { status: 204, statusText: 'No Content' });
    await done;
    expect(session.status()).toBe('signedOut');
    expect(session.endReason()).toBe('signedOut');
    expect(browser.posted.at(-1)).toEqual({ type: 'signed-out' });

    // Another tab signs in: this one restores from the shared cookie.
    browser.handler!({ type: 'signed-in' });
    await settle();
    http.expectOne(`${api}/auth/web/refresh`).flush({ data: { accessToken: 'shared' } });
    await settle();
    flushMe('shared');
    await settle();
    expect(session.status()).toBe('signedIn');
    browser.handler!({ type: 'signed-out' });
    expect(session.status()).toBe('signedOut');
  });

  it('still signs out locally when the server cannot be reached', async () => {
    await signIn();
    const done = session.signOut();
    http.expectOne(`${api}/auth/web/logout`).error(new ProgressEvent('error'));
    await done;
    expect(session.status()).toBe('signedOut');
  });
});
