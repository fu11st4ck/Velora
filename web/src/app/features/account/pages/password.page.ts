import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { type AbstractControl, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { describeFailure } from '../../../core/api/messages';
import { Submission } from '../../../core/state/submission';
import { EntityVersions } from '../../../core/state/entity-versions';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';

const same = (g: AbstractControl) => (g.get('newPassword')?.value === g.get('confirm')?.value ? null : { mismatch: true });

/** W-H4 Change password. Other devices are signed out by the server; this one stays signed in. */
@Component({
  selector: 'app-password-page',
  imports: [ReactiveFormsModule, PageHeader, MatButton, MatFormField, MatLabel, MatInput, MatError, MatHint],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header heading="Change password" />
    <form class="card" [formGroup]="form" (ngSubmit)="save()" novalidate>
      <mat-form-field><mat-label>Current password</mat-label><input matInput type="password" formControlName="currentPassword" autocomplete="current-password" data-testid="current-password" /><mat-error>Enter your current password.</mat-error></mat-form-field>
      <mat-form-field><mat-label>New password</mat-label><input matInput type="password" formControlName="newPassword" autocomplete="new-password" data-testid="new-password" /><mat-hint>At least 10 characters; not a common password.</mat-hint><mat-error>At least 10 characters.</mat-error></mat-form-field>
      <mat-form-field><mat-label>Repeat new password</mat-label><input matInput type="password" formControlName="confirm" autocomplete="new-password" data-testid="confirm-password" /></mat-form-field>
      @if (form.hasError('mismatch') && form.controls.confirm.touched) { <p class="error" role="alert">The new passwords do not match.</p> }
      @if (error(); as e) { <p class="error" role="alert" data-testid="password-error">{{ e }}</p> }
      <p class="t-body-sm t-muted">Your other devices will be signed out.</p>
      <div class="footer"><button matButton="filled" type="submit" [disabled]="submission.sending()" data-testid="password-save">{{ submission.sending() ? 'Saving…' : 'Change password' }}</button></div>
    </form>
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: var(--space-3); max-width: 480px; padding: var(--space-5); border: 1px solid var(--color-line); border-radius: var(--radius-lg); background: var(--color-surface); }
    p { margin: 0; }
    .error { color: var(--color-error); }
    .footer { display: flex; justify-content: flex-end; }
  `,
})
export class PasswordPage {
  private readonly http = inject(HttpClient);
  private readonly notify = inject(Notify);
  private readonly versions = inject(EntityVersions);
  protected readonly submission = new Submission();
  protected readonly form = new FormGroup(
    {
      currentPassword: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      newPassword: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(10), Validators.maxLength(200)] }),
      confirm: new FormControl('', { nonNullable: true }),
    },
    { validators: [same] },
  );
  protected readonly error = computed(() => {
    const f = this.submission.failure();
    return f ? describeFailure(f) : null;
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const { currentPassword, newPassword } = this.form.getRawValue();
    const done = await this.submission.run(async () => {
      await firstValueFrom(this.http.post<void>(`${environment.apiBaseUrl}/auth/change-password`, { currentPassword, newPassword }));
      return true;
    });
    if (done) {
      this.versions.bump('sessions');
      this.form.reset();
      this.notify.success('Password changed. Your other devices were signed out.');
    }
  }
}
