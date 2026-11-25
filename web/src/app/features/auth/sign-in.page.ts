import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { ApiFailure } from '../../core/api/api-failure';
import { describeFailure } from '../../core/api/messages';
import { SessionStore } from '../../core/auth/session.store';
import { AuthLayout } from './auth-layout';

/** Only same-site paths are followed after sign-in (no open redirects). */
export function safeReturnUrl(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/dashboard';
}

@Component({
  selector: 'app-sign-in-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, MatFormField, MatLabel, MatInput, MatError, MatSuffix, MatButton, MatIconButton, MatIcon, MatProgressSpinner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout heading="Sign in" subtitle="Use the email address your business registered for you.">
      @if (notice()) {
        <p class="notice" role="status" data-testid="sign-in-notice">{{ notice() }}</p>
      }
      @if (error()) {
        <p class="error" role="alert" data-testid="sign-in-error">{{ error() }}</p>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <mat-form-field appearance="outline">
          <mat-label>Email</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="username" required data-testid="email" />
          @if (form.controls.email.hasError('required')) {
            <mat-error>Enter your email address.</mat-error>
          } @else if (form.controls.email.hasError('email')) {
            <mat-error>Enter a valid email address.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Password</mat-label>
          <input matInput [type]="showPassword() ? 'text' : 'password'" formControlName="password" autocomplete="current-password" required data-testid="password" />
          <button matIconButton matSuffix type="button" (click)="showPassword.set(!showPassword())" [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'" [attr.aria-pressed]="showPassword()">
            <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
          @if (form.controls.password.hasError('required')) {
            <mat-error>Enter your password.</mat-error>
          }
        </mat-form-field>
        <button matButton="filled" type="submit" class="submit" [disabled]="busy()" [attr.aria-busy]="busy()" data-testid="sign-in">
          @if (busy()) {
            <mat-progress-spinner diameter="18" mode="indeterminate" aria-hidden="true" />
          }
          Sign in
        </button>
      </form>
      <p class="links"><a routerLink="/forgot-password">Forgot your password?</a></p>
    </app-auth-layout>
  `,
  styles: `
    form { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-6); }
    .submit { height: 48px; margin-top: var(--space-2); }
    mat-progress-spinner { display: inline-block; margin-right: var(--space-2); vertical-align: middle; }
    .notice, .error { margin: var(--space-4) 0 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); }
    .notice { color: var(--status-neutral-fg); background: var(--status-neutral-bg); }
    .error { color: var(--status-danger-fg); background: var(--status-danger-bg); }
    .links { margin-top: var(--space-4); }
  `,
})
export class SignInPage {
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(
    this.session.endReason() === 'expired' ? 'Your session ended. Sign in again to continue.' : this.session.endReason() === 'signedOut' ? 'You have signed out.' : null,
  );

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { email, password } = this.form.getRawValue();
      await this.session.signIn(email, password);
      await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')));
    } catch (failure) {
      this.error.set(describeFailure(failure as ApiFailure));
      this.form.controls.password.reset();
    } finally {
      this.busy.set(false);
    }
  }
}
