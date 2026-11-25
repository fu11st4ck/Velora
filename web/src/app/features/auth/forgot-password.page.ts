import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { toApiFailure } from '../../core/api/api-failure';
import { describeFailure } from '../../core/api/messages';
import { AuthApi } from '../../core/auth/auth.api';
import { AuthLayout } from './auth-layout';

@Component({
  selector: 'app-forgot-password-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, MatFormField, MatLabel, MatInput, MatError, MatButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout heading="Reset your password" [subtitle]="sent() ? null : 'We will email you a link to choose a new password.'">
      @if (sent()) {
        <p class="done" role="status" data-testid="forgot-done">If an account exists for {{ form.controls.email.value }}, an email with a link is on its way. The link works once and expires in an hour.</p>
        <p><a routerLink="/sign-in">Back to sign in</a></p>
      } @else {
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
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
          <button matButton="filled" type="submit" [disabled]="busy()" data-testid="send-link">Send link</button>
        </form>
        <p><a routerLink="/sign-in">Back to sign in</a></p>
      }
    </app-auth-layout>
  `,
  styles: `
    form { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-6); }
    button { height: 48px; }
    .done { margin: var(--space-6) 0 var(--space-4); }
    .error { margin: var(--space-4) 0 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); color: var(--status-danger-fg); background: var(--status-danger-bg); }
  `,
})
export class ForgotPasswordPage {
  private readonly api = inject(AuthApi);
  protected readonly form = inject(NonNullableFormBuilder).group({ email: ['', [Validators.required, Validators.email]] });
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.forgotPassword(this.form.controls.email.value.trim());
      this.sent.set(true);
    } catch (e) {
      this.error.set(describeFailure(toApiFailure(e)));
    } finally {
      this.busy.set(false);
    }
  }
}
