import { HttpClient, HttpContext, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SKIP_AUTH } from '../api/http-context';
import type { Envelope, Me, WebSession } from '../api/types';

export interface RefreshedToken {
  accessToken: string;
  accessTokenExpiresAt: string;
}

/**
 * Sign-in endpoints for browsers (docs/web-api-integration.md §2). The refresh token never reaches
 * this code: the server keeps it in an HttpOnly cookie scoped to /api/v1/auth/web.
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;
  /** Proves to the server that the request comes from the web app (with the Origin header). */
  private readonly web = { headers: new HttpHeaders({ 'X-Velora-Client': 'web' }), context: new HttpContext().set(SKIP_AUTH, true) };
  private readonly anonymous = { context: new HttpContext().set(SKIP_AUTH, true) };

  async signIn(email: string, password: string, deviceName: string): Promise<WebSession> {
    const res = await firstValueFrom(this.http.post<Envelope<WebSession>>(`${this.base}/auth/web/login`, { email, password, deviceName }, this.web));
    return res.data;
  }

  async refresh(): Promise<RefreshedToken> {
    const res = await firstValueFrom(this.http.post<Envelope<RefreshedToken>>(`${this.base}/auth/web/refresh`, null, this.web));
    return res.data;
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.post<void>(`${this.base}/auth/web/logout`, null, this.web));
  }

  /** Uses the given token directly: called while a session is being established. */
  async me(accessToken: string): Promise<Me> {
    const res = await firstValueFrom(
      this.http.get<Envelope<Me>>(`${this.base}/auth/me`, { ...this.anonymous, headers: new HttpHeaders({ Authorization: `Bearer ${accessToken}` }) }),
    );
    return res.data;
  }

  async forgotPassword(email: string): Promise<void> {
    await firstValueFrom(this.http.post(`${this.base}/auth/forgot-password`, { email }, this.anonymous));
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await firstValueFrom(this.http.post(`${this.base}/auth/reset-password`, { token, newPassword }, this.anonymous));
  }
}
