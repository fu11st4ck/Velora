import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { Envelope, Member, Organization, OrganizationUpdate, TaxRate } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { EntityVersions } from '../../../core/state/entity-versions';

export type InvitedMember = Member & { invitationEmailSent: boolean };

/** Business settings, tax rates and team (docs/web-api-integration.md). The API enforces who may change what. */
@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly http = inject(HttpClient);
  private readonly versions = inject(EntityVersions);
  private readonly session = inject(SessionStore);
  private readonly base = environment.apiBaseUrl;

  async organization(): Promise<Organization> {
    return (await firstValueFrom(this.http.get<Envelope<Organization>>(`${this.base}/organization`))).data;
  }

  /** Sends only what changed; afterwards the session profile (currency, rules) is reloaded. */
  async updateOrganization(changes: OrganizationUpdate): Promise<Organization> {
    const res = await firstValueFrom(this.http.patch<Envelope<Organization>>(`${this.base}/organization`, changes));
    this.versions.bump('organization');
    await this.session.reloadProfile();
    return res.data;
  }

  async taxRates(): Promise<TaxRate[]> {
    return (await firstValueFrom(this.http.get<Envelope<TaxRate[]>>(`${this.base}/tax-rates`, { params: { includeInactive: true } }))).data;
  }

  async createTaxRate(body: { name: string; rateBp: number; isDefault?: boolean }): Promise<TaxRate> {
    const res = await firstValueFrom(this.http.post<Envelope<TaxRate>>(`${this.base}/tax-rates`, body));
    this.versions.bump('taxRates');
    await this.session.reloadProfile();
    return res.data;
  }

  async updateTaxRate(id: string, body: { name?: string; isDefault?: boolean; isActive?: boolean }): Promise<TaxRate> {
    const res = await firstValueFrom(this.http.patch<Envelope<TaxRate>>(`${this.base}/tax-rates/${encodeURIComponent(id)}`, body));
    this.versions.bump('taxRates');
    await this.session.reloadProfile();
    return res.data;
  }

  async members(): Promise<Member[]> {
    return (await firstValueFrom(this.http.get<Envelope<Member[]>>(`${this.base}/organization/members`))).data;
  }

  async invite(body: { fullName: string; email: string; role: 'MANAGER' | 'SALES' }): Promise<InvitedMember> {
    const res = await firstValueFrom(this.http.post<Envelope<InvitedMember>>(`${this.base}/organization/members`, body));
    this.versions.bump('team');
    return res.data;
  }

  async updateMember(memberId: string, body: { role?: Member['role']; isActive?: boolean }): Promise<Member> {
    const res = await firstValueFrom(this.http.patch<Envelope<Member>>(`${this.base}/organization/members/${encodeURIComponent(memberId)}`, body));
    this.versions.bump('team');
    return res.data;
  }
}
