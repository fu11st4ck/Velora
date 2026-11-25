import { HttpClient, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { toApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { DeviceSession, Envelope } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatDateTime } from '../../../core/dates/dates';
import { EntityVersions } from '../../../core/state/entity-versions';
import { Confirm } from '../../../shared/ui/confirm-dialog';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { StatusPill } from '../../../shared/ui/status-pill';

/** W-H5 Signed-in devices. Signing a device out takes effect on its next request. */
@Component({
  selector: 'app-devices-page',
  imports: [PageHeader, StateView, Skeleton, StatusPill, MatButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header heading="Signed-in devices" subtitle="Browsers and phones where you are signed in." />
    @if (failure(); as m) {
      <app-state-view kind="error" heading="Could not load your devices" [message]="m" actionLabel="Try again" (action)="sessions.reload()" />
    } @else if (sessions.hasValue()) {
      <ul class="list">
        @for (s of sessions.value().data; track s.id) {
          <li data-testid="device-row">
            <div>
              <span class="name">{{ s.deviceName || 'Unnamed device' }}</span>
              @if (s.isCurrent) { <app-status-pill label="This device" tone="success" /> }
              <span class="t-body-sm t-muted block">Last used {{ when(s.lastActiveAt) }} · signed in {{ when(s.signedInAt) }}{{ s.ipAddress ? ' · ' + s.ipAddress : '' }}</span>
            </div>
            @if (!s.isCurrent) {
              <button matButton="outlined" type="button" (click)="signOut(s)" [disabled]="busy()" data-testid="device-sign-out">Sign out</button>
            }
          </li>
        }
      </ul>
    } @else {
      <app-skeleton height="160px" />
    }
  `,
  styles: `
    .list { list-style: none; margin: 0; padding: 0; max-width: 760px; border: 1px solid var(--color-line); border-radius: var(--radius-lg); background: var(--color-surface); }
    li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-5); border-top: 1px solid var(--color-line); }
    li:first-child { border-top: 0; }
    .name { font-weight: 600; margin-right: var(--space-2); }
    .block { display: block; margin-top: var(--space-1); }
  `,
})
export class DevicesPage {
  private readonly http = inject(HttpClient);
  private readonly versions = inject(EntityVersions);
  private readonly session = inject(SessionStore);
  private readonly confirm = inject(Confirm);
  private readonly notify = inject(Notify);
  protected readonly busy = signal(false);
  protected readonly sessions = httpResource<Envelope<DeviceSession[]>>(() => {
    this.versions.of('sessions')();
    return `${environment.apiBaseUrl}/auth/sessions`;
  });
  protected readonly failure = computed(() => {
    const e = this.sessions.error();
    return e ? describeFailure(toApiFailure(e)) : null;
  });

  protected when(iso: string): string {
    return formatDateTime(iso, this.session.me()?.settings.timezone ?? 'UTC');
  }

  protected async signOut(s: DeviceSession): Promise<void> {
    const yes = await this.confirm.ask({ title: `Sign out ${s.deviceName || 'this device'}?`, message: 'Anyone using it will need your password to sign in again.', confirmLabel: 'Sign out' });
    if (!yes) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.delete<void>(`${environment.apiBaseUrl}/auth/sessions/${encodeURIComponent(s.id)}`));
      this.notify.success('Device signed out.');
    } catch (e) {
      this.notify.error(describeFailure(toApiFailure(e)));
    } finally {
      this.busy.set(false);
      this.versions.bump('sessions');
    }
  }
}
