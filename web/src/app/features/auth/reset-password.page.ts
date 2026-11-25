import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toApiFailure } from '../../core/api/api-failure';
import { describeFailure } from '../../core/api/messages';
import { AuthApi } from '../../core/auth/auth.api';
import { AuthLayout } from './auth-layout';

const matching = (group: AbstractControl): ValidationErrors | null =>
  group.get('password')?.value === group.get('confirm')?.value ? null : { mismatch: true };

/** Reset after "Forgot password", and also how invited staff choose their first password. */
@Component({
  selector: 'app-reset-password-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, MatFormField, MatLabel, MatInput, MatError, MatHint, MatButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!token) {
      <app-auth-layout heading="Link not valid">
        <p class="error" role="alert">This link is incomplete. Request a new one.</p>
        <p><a routerLink="/forgot-password">Request a new link</a></p>
      </app-auth-layout>
    } @else if (done()) {
      <app-auth-layout heading="Password saved">
        <p role="status" data-testid="reset-done">You can now sign in with your new password.</p>
        <p><a routerLink="/sign-in">Sign in</a></p>
      </app-auth-layout>
    } @else {
      <app-auth-layout heading="Choose a password">
        @if (error()) {
          <p class="error" role="alert" data-testid="reset-error">{{ error() }}</p>
          @if (expired()) {
            <p><a routerLink="/forgot-password">Request a new link</a></p>
          }
        }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <mat-form-field appearance="outline">
            <mat-label>New password</mat-label>
            <input matInput type="password" formControlName="password" autocomplete="new-password" required data-testid="new-password" />
            <mat-hint>At least 10 characters. Avoid common passwords.</mat-hint>
            @if (form.controls.password.hasError('required')) {
              <mat-error>Enter a new password.</mat-error>
            } @else if (form.controls.password.hasError('minlength')) {
              <mat-error>Use at least 10 characters.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>New password again</mat-label>
            <input matInput type="password" formControlName="confirm" autocomplete="new-password" required data-testid="confirm-password" />
          </mat-form-field>
          @if (form.touched && form.hasError('mismatch')) {
            <p class="mismatch" role="alert">The two passwords do not match.</p>
          }
          <button matButton="filled" type="submit" [disabled]="busy()" data-testid="save-password">Save password</button>
        </form>
      </app-auth-layout>
    }
  `,
  styles: `
    form { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-6); }
    button { height: 48px; }
    .error, .mismatch { margin: var(--space-4) 0 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); color: var(--status-danger-fg); background: var(--status-danger-bg); }
    .mismatch { margin: 0; }
  `,
})
export class ResetPasswordPage {
  private readonly api = inject(AuthApi);
  protected readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');
  protected readonly form = inject(NonNullableFormBuilder).group(
    { password: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(200)]], confirm: [''] },
    { validators: matching },
  );
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly expired = signal(false);

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy() || !this.token) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.resetPassword(this.token, this.form.controls.password.value);
      this.done.set(true);
    } catch (e) {
      const failure = toApiFailure(e);
      this.expired.set(failure.kind === 'business' && failure.code === 'RESET_TOKEN_INVALID');
      this.error.set(describeFailure(failure));
    } finally {
      this.busy.set(false);
    }
  }
}
