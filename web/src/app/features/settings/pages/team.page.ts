import { ScrollRegion } from '../../../shared/table/scroll-region';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { toApiFailure, type ApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { Member, Role } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatDateTime } from '../../../core/dates/dates';
import { Confirm } from '../../../shared/ui/confirm-dialog';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { StatusPill } from '../../../shared/ui/status-pill';
import { SettingsApi } from '../data/settings.api';

const ROLE_LABELS: Record<Role, string> = { OWNER: 'Owner', MANAGER: 'Manager', SALES: 'Sales' };

/** W-H3 Team. The owner invites, changes roles and removes access; removing access signs the person out at once. */
@Component({
  selector: 'app-team-page',
  imports: [ScrollRegion, ReactiveFormsModule, PageHeader, StateView, Skeleton, StatusPill, MatButton, MatFormField, MatLabel, MatInput, MatError, MatSelect, MatOption],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header heading="Team" [subtitle]="canEdit() ? null : 'Only the owner can change the team.'" />
    @if (canEdit()) {
      <form class="card invite" [formGroup]="form" (ngSubmit)="invite()" novalidate aria-labelledby="invite-title">
        <h2 class="t-title-md" id="invite-title">Invite someone</h2>
        <div class="row">
          <mat-form-field><mat-label>Full name</mat-label><input matInput formControlName="fullName" maxlength="120" data-testid="invite-name" /><mat-error>Enter their name.</mat-error></mat-form-field>
          <mat-form-field><mat-label>Email</mat-label><input matInput formControlName="email" type="email" maxlength="254" data-testid="invite-email" /><mat-error>Enter a valid email address.</mat-error></mat-form-field>
          <mat-form-field><mat-label>Role</mat-label><mat-select formControlName="role" data-testid="invite-role"><mat-option value="SALES">Sales</mat-option><mat-option value="MANAGER">Manager</mat-option></mat-select></mat-form-field>
        </div>
        <p class="t-body-sm t-muted">They receive an email with a link to choose a password. Sales see prices but never cost or profit.</p>
        @if (inviteResult(); as r) { <p class="result" role="status" data-testid="invite-result">{{ r }}</p> }
        <div class="footer"><button matButton="filled" type="submit" [disabled]="busy()" data-testid="invite-submit">Send invitation</button></div>
      </form>
    }
    @if (failure(); as f) {
      <app-state-view kind="error" heading="Could not load the team" [message]="message(f)" actionLabel="Try again" (action)="load()" />
    } @else if (members(); as list) {
      <div class="table-wrap" appScrollRegion="Team members table">
        <table class="table" data-testid="team-table">
          <caption class="visually-hidden">Team members</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last signed in</th>@if (canEdit()) {<th scope="col"><span class="visually-hidden">Actions</span></th>}</tr></thead>
          <tbody>
            @for (m of list; track m.memberId) {
              <tr data-testid="team-row">
                <td>{{ m.fullName }}@if (isMe(m)) { <span class="t-muted"> (you)</span> }</td>
                <td>{{ m.email }}</td>
                <td>
                  @if (canEdit() && !isMe(m) && m.isActive) {
                    <mat-select class="role" [value]="m.role" (selectionChange)="changeRole(m, $event.value)" [attr.aria-label]="'Role of ' + m.fullName" data-testid="member-role">
                      <mat-option value="SALES">Sales</mat-option><mat-option value="MANAGER">Manager</mat-option><mat-option value="OWNER">Owner</mat-option>
                    </mat-select>
                  } @else {
                    {{ role(m.role) }}
                  }
                </td>
                <td>
                  @if (!m.isActive) { <app-status-pill label="No access" tone="danger" /> }
                  @else if (m.isPending) { <app-status-pill label="Invited" tone="warning" /> }
                  @else { <app-status-pill label="Active" tone="success" /> }
                </td>
                <td class="nowrap">{{ lastLogin(m) }}</td>
                @if (canEdit()) {
                  <td class="actions">
                    @if (!isMe(m)) {
                      @if (m.isActive) {
                        <button matButton type="button" (click)="setAccess(m, false)" [disabled]="busy()" data-testid="member-remove">Remove access</button>
                      } @else {
                        <button matButton type="button" (click)="setAccess(m, true)" [disabled]="busy()" data-testid="member-restore">Restore access</button>
                      }
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <app-skeleton height="200px" />
    }
  `,
  styleUrl: './settings.scss',
  styles: `.invite { margin-bottom: var(--space-4); max-width: 960px; } .role { width: 130px; } .nowrap { white-space: nowrap; } .result { font-weight: 600; }`,
})
export class TeamPage {
  private readonly api = inject(SettingsApi);
  private readonly session = inject(SessionStore);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  protected readonly canEdit = computed(() => this.session.can('team.manage'));
  protected readonly members = signal<Member[] | null>(null);
  protected readonly failure = signal<ApiFailure | null>(null);
  protected readonly busy = signal(false);
  protected readonly inviteResult = signal<string | null>(null);
  protected readonly form = new FormGroup({
    fullName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2), Validators.maxLength(120)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(254)] }),
    role: new FormControl<'SALES' | 'MANAGER'>('SALES', { nonNullable: true }),
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.failure.set(null);
    try {
      this.members.set(await this.api.members());
    } catch (e) {
      this.failure.set(toApiFailure(e));
    }
  }

  protected isMe(m: Member): boolean {
    return m.userId === this.session.me()?.user.id;
  }
  protected role(r: Role): string {
    return ROLE_LABELS[r];
  }
  protected lastLogin(m: Member): string {
    return m.lastLoginAt ? formatDateTime(m.lastLoginAt, this.session.me()?.settings.timezone ?? 'UTC') : '—';
  }
  protected message(f: ApiFailure): string {
    return describeFailure(f);
  }

  private async run<T>(task: () => Promise<T>): Promise<T | undefined> {
    this.busy.set(true);
    try {
      return await task();
    } catch (e) {
      this.notify.error(describeFailure(toApiFailure(e)));
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  protected async invite(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    const result = await this.run(() => this.api.invite({ fullName: v.fullName.trim(), email: v.email.trim(), role: v.role }));
    if (!result) return;
    this.inviteResult.set(
      result.invitationEmailSent
        ? `Invitation sent to ${result.email}.`
        : `${result.fullName} was added, but the email could not be sent. Ask them to use “Forgot password” on the sign-in page with ${result.email}.`,
    );
    this.form.reset({ fullName: '', email: '', role: 'SALES' });
    await this.load();
  }

  protected async changeRole(m: Member, role: Role): Promise<void> {
    if (role === m.role) return;
    const updated = await this.run(() => this.api.updateMember(m.memberId, { role }));
    if (updated) this.notify.success(`${m.fullName} is now ${ROLE_LABELS[role].toLowerCase()}.`);
    await this.load();
  }

  protected async setAccess(m: Member, isActive: boolean): Promise<void> {
    if (!isActive) {
      const yes = await this.confirm.ask({ title: `Remove ${m.fullName}'s access?`, message: 'They are signed out on every device at once and can no longer sign in. Their sales and documents are kept.', confirmLabel: 'Remove access', danger: true });
      if (!yes) return;
    }
    const updated = await this.run(() => this.api.updateMember(m.memberId, { isActive }));
    if (updated) this.notify.success(isActive ? `${m.fullName} can sign in again.` : `${m.fullName} no longer has access.`);
    await this.load();
  }
}
