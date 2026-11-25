import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { type AbstractControl, FormControl, FormGroup, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { describeFailure } from '../../../core/api/messages';
import type { Customer, CustomerInput } from '../../../core/api/types';
import { Submission } from '../../../core/state/submission';
import { CustomersApi, customerLabel } from '../data/customers.api';

/** A customer needs a person's name or a company (the server and the database enforce it too). */
function nameOrCompany(group: AbstractControl): ValidationErrors | null {
  const name = String(group.get('name')?.value ?? '').trim();
  const company = String(group.get('company')?.value ?? '').trim();
  return name || company ? null : { nameOrCompany: true };
}

/**
 * W-E3 customer form, used by the customer pages and inside the sale's customer picker.
 * Before creating, it looks for a customer with the same mobile number and offers that one.
 */
@Component({
  selector: 'app-customer-form',
  imports: [ReactiveFormsModule, MatButton, MatFormField, MatLabel, MatInput, MatError, MatHint],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <div class="row">
        <mat-form-field>
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" maxlength="160" autocomplete="off" data-testid="customer-name" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Company</mat-label>
          <input matInput formControlName="company" maxlength="160" autocomplete="off" data-testid="customer-company" />
        </mat-form-field>
      </div>
      @if (form.hasError('nameOrCompany') && (form.controls.name.touched || form.controls.company.touched)) {
        <p class="error" role="alert">Enter a name or a company.</p>
      }
      <div class="row">
        <mat-form-field>
          <mat-label>Mobile</mat-label>
          <input matInput formControlName="mobile" type="tel" maxlength="32" autocomplete="off" data-testid="customer-mobile" />
          <mat-hint>Numbers without a country code are read as local.</mat-hint>
          <mat-error>This is not a valid phone number.</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Email</mat-label>
          <input matInput formControlName="email" type="email" maxlength="254" autocomplete="off" data-testid="customer-email" />
          <mat-error>Enter a valid email address.</mat-error>
        </mat-form-field>
      </div>
      @if (!compact()) {
        <mat-form-field class="wide">
          <mat-label>Address</mat-label>
          <input matInput formControlName="address" maxlength="240" autocomplete="off" />
        </mat-form-field>
        <mat-form-field class="wide">
          <mat-label>Tax registration number (TRN)</mat-label>
          <input matInput formControlName="taxRegistrationNumber" maxlength="40" autocomplete="off" />
        </mat-form-field>
        <mat-form-field class="wide">
          <mat-label>Notes</mat-label>
          <textarea matInput formControlName="notes" rows="3" maxlength="1000"></textarea>
        </mat-form-field>
      }

      @if (duplicates().length > 0) {
        <div class="duplicate" role="alert" data-testid="duplicate-mobile">
          <p>This number is already saved for:</p>
          <ul>
            @for (c of duplicates(); track c.id) {
              <li>
                <span>{{ label(c) }}</span>
                <button matButton="outlined" type="button" (click)="useExisting.emit(c)" data-testid="use-existing">Use this customer</button>
              </li>
            }
          </ul>
          <button matButton type="button" (click)="saveAnyway()" data-testid="save-anyway">Save as a new customer</button>
        </div>
      }
      @if (message(); as m) {
        <p class="error" role="alert" data-testid="customer-error">{{ m }}</p>
      }
      <div class="actions">
        <button matButton type="button" (click)="cancelled.emit()" [disabled]="submission.sending()">Cancel</button>
        <button matButton="filled" type="submit" [disabled]="submission.sending() || checking()" data-testid="customer-save">
          {{ submission.sending() || checking() ? 'Saving…' : customer() ? 'Save changes' : 'Create customer' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    form { display: flex; flex-direction: column; gap: var(--space-3); }
    .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-3); }
    .wide { width: 100%; }
    .error { margin: 0; color: var(--color-error); }
    .actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
    .duplicate { padding: var(--space-4); border-radius: var(--radius-md); background: var(--status-warning-bg); color: var(--status-warning-fg);
      p { margin: 0 0 var(--space-2); }
      ul { list-style: none; margin: 0 0 var(--space-2); padding: 0; display: grid; gap: var(--space-2); }
      li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
    }
  `,
})
export class CustomerForm {
  /** The customer being edited; absent when creating. */
  readonly customer = input<Customer | null>(null);
  /** Fewer fields (inside the sale's picker): address, TRN and notes can be added later. */
  readonly compact = input(false);
  readonly saved = output<Customer>();
  readonly useExisting = output<Customer>();
  readonly cancelled = output<void>();

  private readonly api = inject(CustomersApi);
  protected readonly submission = new Submission();
  protected readonly duplicates = signal<Customer[]>([]);
  protected readonly checking = signal(false);
  private duplicateCheckedFor: string | null = null;

  protected readonly form = new FormGroup(
    {
      name: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(160)] }),
      company: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(160)] }),
      mobile: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(32)] }),
      email: new FormControl('', { nonNullable: true, validators: [Validators.email, Validators.maxLength(254)] }),
      address: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(240)] }),
      taxRegistrationNumber: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
      notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] }),
    },
    { validators: [nameOrCompany] },
  );
  protected readonly message = computed(() => {
    const f = this.submission.failure();
    if (!f) return null;
    if (this.submission.unconfirmed()) return 'The connection dropped before Velora confirmed this. Save again — the customer will not be created twice.';
    if (f.kind === 'validation') return f.fields['mobile'] ? null : 'Some fields need attention.';
    return describeFailure(f);
  });

  constructor() {
    effect(() => {
      const c = this.customer();
      untracked(() => {
        if (!c) return;
        this.form.reset({
          name: c.name ?? '', company: c.company ?? '', mobile: c.mobile ?? '', email: c.email ?? '',
          address: c.address ?? '', taxRegistrationNumber: c.taxRegistrationNumber ?? '', notes: c.notes ?? '',
        });
      });
    });
    this.form.valueChanges.subscribe(() => this.submission.inputChanged());
    this.form.controls.mobile.valueChanges.subscribe(() => this.duplicates.set([]));
  }

  protected label(c: Customer): string {
    return `${customerLabel(c)}${c.mobile ? ` · ${c.mobile}` : ''}`;
  }

  private body(): CustomerInput {
    const v = this.form.getRawValue();
    const clean = (s: string) => s.trim() || null;
    return {
      name: clean(v.name), company: clean(v.company), mobile: clean(v.mobile), email: clean(v.email),
      address: clean(v.address), taxRegistrationNumber: clean(v.taxRegistrationNumber), notes: clean(v.notes),
    };
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const mobile = this.form.controls.mobile.value.trim();
    const editingSameNumber = this.customer()?.mobile === mobile;
    if (mobile && !editingSameNumber && this.duplicateCheckedFor !== mobile) {
      this.checking.set(true);
      try {
        const found = (await this.api.withMobile(mobile)).filter((c) => c.id !== this.customer()?.id);
        this.duplicateCheckedFor = mobile;
        if (found.length > 0) {
          this.duplicates.set(found);
          return;
        }
      } catch {
        // The check is a convenience; the save below reports any real problem.
      } finally {
        this.checking.set(false);
      }
    }
    await this.send();
  }

  protected async saveAnyway(): Promise<void> {
    this.duplicates.set([]);
    await this.send();
  }

  private async send(): Promise<void> {
    const existing = this.customer();
    const body = this.body();
    const result = existing
      ? await this.submission.run(() => this.api.update(existing.id, body))
      : await this.submission.run((key) => this.api.create(body, key));
    if (result) {
      this.saved.emit(result);
      return;
    }
    const f = this.submission.failure();
    if (f?.kind === 'validation') {
      for (const field of Object.keys(f.fields)) {
        const control = this.form.get(field);
        control?.setErrors({ server: true });
        control?.markAsTouched();
      }
    }
  }
}
