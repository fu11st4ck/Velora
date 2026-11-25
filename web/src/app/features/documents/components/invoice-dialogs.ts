import { DIALOG_DEFAULTS } from '../../../shared/ui/dialog-defaults';
import { ChangeDetectionStrategy, Component, Injectable, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { describeFailure } from '../../../core/api/messages';
import type { Invoice } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatMoney, parseMoney } from '../../../core/money/money';
import { Submission } from '../../../core/state/submission';
import { moneyValidator } from '../../../shared/forms/validators';
import { DocumentsApi, type PaymentMethod } from '../data/documents.api';

const LOST = 'The connection dropped before Velora confirmed this. Try again — it will not be recorded twice.';
const minLength3 = (c: { value: unknown }) => (String(c.value ?? '').trim().length >= 3 ? null : { short: true });

/** While a change is being sent the dialog cannot be dismissed (docs/web-state-management.md §6). */
function holdWhileSending(ref: MatDialogRef<unknown>, s: Submission): void {
  effect(() => (ref.disableClose = s.sending()));
}

function message(s: Submission): string | null {
  const f = s.failure();
  if (!f) return null;
  return s.unconfirmed() ? LOST : describeFailure(f);
}

const IMPORTS = [ReactiveFormsModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, MatButtonToggleGroup, MatButtonToggle, MatFormField, MatLabel, MatInput, MatError];
const STYLES = `
  form { display: contents; }
  mat-dialog-content { display: flex; flex-direction: column; gap: var(--space-3); }
  p { margin: 0; }
  mat-form-field { width: 100%; }
  mat-button-toggle-group { align-self: flex-start; }
  .error { color: var(--color-error); }
  .outcome { font-weight: 600; }
  .consequences { margin: 0; padding-left: var(--space-5); }
`;

/** W-F4 Record payment: amount defaults to the balance and cannot exceed it. */
@Component({
  selector: 'app-record-payment-dialog',
  imports: [...IMPORTS, MatSuffix],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Record payment</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="t-muted">{{ invoice.number }} · balance {{ money(invoice.balanceMinor) }}</p>
        <mat-form-field>
          <mat-label>Amount received</mat-label>
          <input matInput formControlName="amount" inputmode="decimal" autocomplete="off" data-testid="payment-amount" />
          <span matTextSuffix>{{ invoice.currencyCode }}</span>
          @if (form.controls.amount.hasError('tooMuch')) {
            <mat-error>At most the balance, {{ money(invoice.balanceMinor) }}.</mat-error>
          } @else {
            <mat-error>Enter an amount, for example 500.00.</mat-error>
          }
        </mat-form-field>
        <mat-button-toggle-group formControlName="method" aria-label="Payment method" hideSingleSelectionIndicator>
          <mat-button-toggle value="CASH">Cash</mat-button-toggle>
          <mat-button-toggle value="BANK_TRANSFER" data-testid="payment-bank">Bank transfer</mat-button-toggle>
        </mat-button-toggle-group>
        @if (form.controls.method.value === 'BANK_TRANSFER') {
          <mat-form-field>
            <mat-label>Transfer reference (optional)</mat-label>
            <input matInput formControlName="reference" maxlength="80" autocomplete="off" data-testid="payment-reference" />
          </mat-form-field>
        }
        <mat-form-field>
          <mat-label>Note (optional)</mat-label>
          <input matInput formControlName="note" maxlength="240" autocomplete="off" />
        </mat-form-field>
        @if (outcome(); as o) {
          <p class="outcome" aria-live="polite" data-testid="payment-outcome">{{ o }}</p>
        }
        @if (error(); as e) {
          <p class="error" role="alert" data-testid="dialog-error">{{ e }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" (click)="ref.close()" [disabled]="submission.sending()">Cancel</button>
        <button matButton="filled" type="submit" [disabled]="submission.sending()" data-testid="payment-submit">
          {{ submission.sending() ? 'Saving…' : submission.unconfirmed() ? 'Try again' : 'Record payment' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: STYLES,
})
export class RecordPaymentDialog {
  protected readonly invoice = inject<Invoice>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<RecordPaymentDialog, Invoice>>(MatDialogRef);
  private readonly api = inject(DocumentsApi);
  private readonly session = inject(SessionStore);
  protected readonly submission = new Submission();
  private readonly exponent = () => this.session.money().exponent;
  protected readonly form = new FormGroup({
    amount: new FormControl(formatMoney(this.invoice.balanceMinor, this.session.money(), { withCode: false }), {
      nonNullable: true,
      validators: [moneyValidator(this.exponent, { required: true, min: 1 }), (c) => ((parseMoney(String(c.value), { exponent: this.exponent() }) ?? 0) > this.invoice.balanceMinor ? { tooMuch: true } : null)],
    }),
    method: new FormControl<PaymentMethod>('CASH', { nonNullable: true }),
    reference: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
    note: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(240)] }),
  });
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly error = computed(() => message(this.submission));
  protected readonly outcome = computed(() => {
    const amount = parseMoney(this.values().amount ?? '', { exponent: this.exponent() });
    if (amount === null || amount <= 0 || amount > this.invoice.balanceMinor) return null;
    const left = this.invoice.balanceMinor - amount;
    return left === 0 ? 'The invoice will be paid in full.' : `${this.money(left)} will remain to be paid.`;
  });

  constructor() {
    this.form.valueChanges.subscribe(() => this.submission.inputChanged());
    holdWhileSending(this.ref, this.submission);
  }

  protected money(minor: number): string {
    return formatMoney(minor, this.session.money());
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    const body = {
      amountMinor: parseMoney(v.amount, { exponent: this.exponent() }) ?? 0,
      method: v.method,
      reference: v.method === 'BANK_TRANSFER' ? v.reference.trim() || null : null,
      note: v.note.trim() || null,
    };
    const result = await this.submission.run((k) => this.api.recordPayment(this.invoice.id, body, k));
    if (result) this.ref.close(result.invoice);
  }
}

/** W-F5 Refund: a correction for money received by mistake (not a return of goods). */
@Component({
  selector: 'app-refund-dialog',
  imports: [...IMPORTS, MatSuffix],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Refund money</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="t-muted">{{ invoice.number }} · received {{ money(invoice.paidMinor) }}</p>
        <p class="t-body-sm">For money received by mistake. To take goods back, use <strong>Return items</strong> instead.</p>
        <mat-form-field>
          <mat-label>Amount refunded</mat-label>
          <input matInput formControlName="amount" inputmode="decimal" autocomplete="off" data-testid="refund-amount" />
          <span matTextSuffix>{{ invoice.currencyCode }}</span>
          @if (form.controls.amount.hasError('tooMuch')) {
            <mat-error>At most the amount received, {{ money(invoice.paidMinor) }}.</mat-error>
          } @else {
            <mat-error>Enter an amount, for example 100.00.</mat-error>
          }
        </mat-form-field>
        <mat-button-toggle-group formControlName="method" aria-label="Refund method" hideSingleSelectionIndicator>
          <mat-button-toggle value="CASH">Cash</mat-button-toggle>
          <mat-button-toggle value="BANK_TRANSFER">Bank transfer</mat-button-toggle>
        </mat-button-toggle-group>
        @if (form.controls.method.value === 'BANK_TRANSFER') {
          <mat-form-field>
            <mat-label>Transfer reference (optional)</mat-label>
            <input matInput formControlName="reference" maxlength="80" autocomplete="off" />
          </mat-form-field>
        }
        <mat-form-field>
          <mat-label>Reason (recorded)</mat-label>
          <input matInput formControlName="note" maxlength="240" autocomplete="off" data-testid="refund-reason" />
          <mat-error>Give a reason of at least 3 characters.</mat-error>
        </mat-form-field>
        @if (error(); as e) {
          <p class="error" role="alert" data-testid="dialog-error">{{ e }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" (click)="ref.close()" [disabled]="submission.sending()">Cancel</button>
        <button matButton="filled" type="submit" [disabled]="submission.sending()" data-testid="refund-submit">
          {{ submission.sending() ? 'Saving…' : submission.unconfirmed() ? 'Try again' : 'Record refund' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: STYLES,
})
export class RefundDialog {
  protected readonly invoice = inject<Invoice>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<RefundDialog, Invoice>>(MatDialogRef);
  private readonly api = inject(DocumentsApi);
  private readonly session = inject(SessionStore);
  protected readonly submission = new Submission();
  private readonly exponent = () => this.session.money().exponent;
  protected readonly form = new FormGroup({
    amount: new FormControl('', {
      nonNullable: true,
      validators: [moneyValidator(this.exponent, { required: true, min: 1 }), (c) => ((parseMoney(String(c.value), { exponent: this.exponent() }) ?? 0) > this.invoice.paidMinor ? { tooMuch: true } : null)],
    }),
    method: new FormControl<PaymentMethod>('CASH', { nonNullable: true }),
    reference: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
    note: new FormControl('', { nonNullable: true, validators: [Validators.required, minLength3, Validators.maxLength(240)] }),
  });
  protected readonly error = computed(() => message(this.submission));

  constructor() {
    this.form.valueChanges.subscribe(() => this.submission.inputChanged());
    holdWhileSending(this.ref, this.submission);
  }

  protected money(minor: number): string {
    return formatMoney(minor, this.session.money());
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    const body = {
      amountMinor: parseMoney(v.amount, { exponent: this.exponent() }) ?? 0,
      method: v.method,
      reference: v.method === 'BANK_TRANSFER' ? v.reference.trim() || null : null,
      note: v.note.trim(),
    };
    const result = await this.submission.run((k) => this.api.refund(this.invoice.id, body, k));
    if (result) this.ref.close(result.invoice);
  }
}

/** W-F6 Cancel invoice: the whole sale is reversed — stock comes back, money received is refunded. */
@Component({
  selector: 'app-cancel-invoice-dialog',
  imports: IMPORTS,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Cancel {{ invoice.number }}?</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <ul class="consequences">
          <li>{{ items }} {{ items === 1 ? 'item goes' : 'items go' }} back to stock.</li>
          @if (invoice.paidMinor > 0) {
            <li>{{ money(invoice.paidMinor) }} received is recorded as refunded.</li>
          }
          <li>The invoice stays in the records, marked cancelled. This cannot be undone.</li>
        </ul>
        <mat-form-field>
          <mat-label>Reason (recorded)</mat-label>
          <input matInput formControlName="reason" maxlength="240" autocomplete="off" data-testid="cancel-reason" />
          <mat-error>Give a reason of at least 3 characters.</mat-error>
        </mat-form-field>
        @if (invoice.paidMinor > 0) {
          <p>How is the {{ money(invoice.paidMinor) }} given back?</p>
          <mat-button-toggle-group formControlName="refundMethod" aria-label="Refund method" hideSingleSelectionIndicator>
            <mat-button-toggle value="CASH" data-testid="cancel-cash">Cash</mat-button-toggle>
            <mat-button-toggle value="BANK_TRANSFER">Bank transfer</mat-button-toggle>
          </mat-button-toggle-group>
          @if (form.controls.refundMethod.value === 'BANK_TRANSFER') {
            <mat-form-field>
              <mat-label>Transfer reference (optional)</mat-label>
              <input matInput formControlName="reference" maxlength="80" autocomplete="off" />
            </mat-form-field>
          }
        }
        @if (error(); as e) {
          <p class="error" role="alert" data-testid="dialog-error">{{ e }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" (click)="ref.close()" [disabled]="submission.sending()">Keep invoice</button>
        <button matButton="filled" type="submit" class="danger" [disabled]="submission.sending()" data-testid="cancel-submit">
          {{ submission.sending() ? 'Cancelling…' : submission.unconfirmed() ? 'Try again' : 'Cancel invoice' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: STYLES + ` .danger { --mat-button-filled-container-color: var(--status-danger-fg); }`,
})
export class CancelInvoiceDialog {
  protected readonly invoice = inject<Invoice>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<CancelInvoiceDialog, Invoice>>(MatDialogRef);
  private readonly api = inject(DocumentsApi);
  private readonly session = inject(SessionStore);
  protected readonly submission = new Submission();
  protected readonly items = this.invoice.lines.reduce((n, l) => n + l.quantity, 0);
  protected readonly form = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: [Validators.required, minLength3, Validators.maxLength(240)] }),
    refundMethod: new FormControl<PaymentMethod | null>(null, { validators: this.invoice.paidMinor > 0 ? [Validators.required] : [] }),
    reference: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
  });
  protected readonly error = computed(() => message(this.submission));

  constructor() {
    this.form.valueChanges.subscribe(() => this.submission.inputChanged());
    holdWhileSending(this.ref, this.submission);
  }

  protected money(minor: number): string {
    return formatMoney(minor, this.session.money());
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    const body = {
      reason: v.reason.trim(),
      ...(this.invoice.paidMinor > 0 && v.refundMethod ? { refundMethod: v.refundMethod, refundReference: v.refundMethod === 'BANK_TRANSFER' ? v.reference.trim() || null : null } : {}),
    };
    const result = await this.submission.run((k) => this.api.cancelInvoice(this.invoice.id, body, k));
    if (result) this.ref.close(result);
  }
}

@Injectable({ providedIn: 'root' })
export class InvoiceDialogs {
  private readonly dialog = inject(MatDialog);

  private open<T>(component: new (...args: never[]) => T, invoice: Invoice): Promise<Invoice | undefined> {
    const ref = this.dialog.open<T, Invoice, Invoice>(component as never, { ...DIALOG_DEFAULTS, data: invoice, width: '480px', maxWidth: '96vw', autoFocus: 'first-tabbable', disableClose: false });
    return firstValueFrom(ref.afterClosed());
  }

  recordPayment(invoice: Invoice) {
    return this.open(RecordPaymentDialog, invoice);
  }
  refund(invoice: Invoice) {
    return this.open(RefundDialog, invoice);
  }
  cancel(invoice: Invoice) {
    return this.open(CancelInvoiceDialog, invoice);
  }
}
