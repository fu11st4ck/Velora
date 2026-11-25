import { ChangeDetectionStrategy, Component, Injectable, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { firstValueFrom } from 'rxjs';
import { describeFailure } from '../../../core/api/messages';
import type { Product } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatMoney, parseMoney } from '../../../core/money/money';
import { Submission } from '../../../core/state/submission';
import { moneyValidator, wholeNumber } from '../../../shared/forms/validators';
import { Notify } from '../../../shared/ui/notify';
import { InventoryApi, type StockChange } from '../data/inventory.api';

const MAX_QUANTITY = 1_000_000;

/** Text shown when the answer to a change was lost: the retry reuses the same idempotency key. */
const UNCONFIRMED = 'The connection dropped before Velora confirmed this. Try again — it will not be recorded twice.';

function submissionMessage(s: Submission): string | null {
  const f = s.failure();
  if (!f) return null;
  return s.unconfirmed() ? UNCONFIRMED : describeFailure(f);
}

/** W-C4 Receive stock. */
@Component({
  selector: 'app-receive-stock-dialog',
  imports: [ReactiveFormsModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, MatFormField, MatLabel, MatInput, MatError, MatHint, MatSuffix],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Receive stock</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="t-muted context">{{ product.name }} · {{ product.sku }} · {{ product.quantity }} on hand</p>
        <mat-form-field>
          <mat-label>Quantity received</mat-label>
          <input matInput formControlName="quantity" inputmode="numeric" autocomplete="off" data-testid="receive-quantity" cdkFocusInitial />
          <mat-error>Enter a whole number from 1 to 1,000,000.</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Unit cost</mat-label>
          <input matInput formControlName="unitCost" inputmode="decimal" autocomplete="off" data-testid="receive-cost" />
          <span matTextSuffix>{{ currency() }}</span>
          <mat-hint>What you paid per unit. The average cost is recalculated.</mat-hint>
          <mat-error>Enter an amount, for example 2,800.00.</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Supplier (optional)</mat-label>
          <input matInput formControlName="supplierName" maxlength="120" autocomplete="off" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Reference (optional)</mat-label>
          <input matInput formControlName="referenceNote" maxlength="240" autocomplete="off" />
          <mat-hint>Delivery note or supplier invoice number.</mat-hint>
        </mat-form-field>
        @if (message(); as m) {
          <p class="error" role="alert" data-testid="dialog-error">{{ m }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" (click)="ref.close()" [disabled]="submission.sending()">Cancel</button>
        <button matButton="filled" type="submit" [disabled]="submission.sending()" data-testid="receive-submit">
          {{ submission.sending() ? 'Saving…' : submission.unconfirmed() ? 'Try again' : 'Receive' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styleUrl: './stock-dialogs.scss',
})
export class ReceiveStockDialog {
  protected readonly product = inject<Product>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<ReceiveStockDialog, StockChange>>(MatDialogRef);
  private readonly api = inject(InventoryApi);
  private readonly session = inject(SessionStore);
  protected readonly submission = new Submission();
  protected readonly currency = computed(() => this.session.money().currencyCode);
  private readonly exponent = () => this.session.money().exponent;

  protected readonly form = new FormGroup({
    quantity: new FormControl('', { nonNullable: true, validators: [wholeNumber({ required: true, min: 1, max: MAX_QUANTITY })] }),
    unitCost: new FormControl(
      this.product.costMinor === undefined || this.product.costMinor === null ? '' : formatMoney(this.product.costMinor, this.session.money(), { withCode: false }),
      { nonNullable: true, validators: [moneyValidator(this.exponent, { required: true, min: 0 })] },
    ),
    supplierName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
    referenceNote: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(240)] }),
  });
  protected readonly message = computed(() => submissionMessage(this.submission));

  constructor() {
    this.form.valueChanges.subscribe(() => this.submission.inputChanged());
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body = {
      productId: this.product.id,
      quantity: Number(v.quantity),
      unitCostMinor: parseMoney(v.unitCost, { exponent: this.exponent() }) ?? 0,
      supplierName: v.supplierName.trim() || null,
      referenceNote: v.referenceNote.trim() || null,
    };
    const result = await this.submission.run((key) => this.api.receive(body, key));
    if (result) this.ref.close(result);
  }
}

/** W-C5 Adjust stock. */
@Component({
  selector: 'app-adjust-stock-dialog',
  imports: [ReactiveFormsModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, MatFormField, MatLabel, MatInput, MatError, MatHint, MatRadioGroup, MatRadioButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Adjust stock</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content>
        <p class="t-muted context">{{ product.name }} · {{ product.sku }} · {{ product.quantity }} on hand</p>
        <mat-radio-group formControlName="direction" aria-label="Direction" class="direction">
          <mat-radio-button value="in" data-testid="adjust-in">Add stock</mat-radio-button>
          <mat-radio-button value="out" data-testid="adjust-out" [disabled]="product.quantity === 0">Remove stock</mat-radio-button>
        </mat-radio-group>
        <mat-form-field>
          <mat-label>Quantity</mat-label>
          <input matInput formControlName="quantity" inputmode="numeric" autocomplete="off" data-testid="adjust-quantity" />
          @if (form.controls.quantity.hasError('max') && form.controls.direction.value === 'out') {
            <mat-error>Only {{ product.quantity }} on hand.</mat-error>
          } @else {
            <mat-error>Enter a whole number from 1 to 1,000,000.</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Reason</mat-label>
          <input matInput formControlName="reason" maxlength="240" autocomplete="off" data-testid="adjust-reason" />
          <mat-hint>For example: damaged, count correction, sample.</mat-hint>
          <mat-error>Give a reason of at least 3 characters.</mat-error>
        </mat-form-field>
        @if (message(); as m) {
          <p class="error" role="alert" data-testid="dialog-error">{{ m }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" (click)="ref.close()" [disabled]="submission.sending()">Cancel</button>
        <button matButton="filled" type="submit" [disabled]="submission.sending()" data-testid="adjust-submit">
          {{ submission.sending() ? 'Saving…' : submission.unconfirmed() ? 'Try again' : 'Save adjustment' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styleUrl: './stock-dialogs.scss',
})
export class AdjustStockDialog {
  protected readonly product = inject<Product>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<AdjustStockDialog, StockChange>>(MatDialogRef);
  private readonly api = inject(InventoryApi);
  protected readonly submission = new Submission();
  private readonly direction = signal<'in' | 'out'>('in');

  protected readonly form = new FormGroup({
    direction: new FormControl<'in' | 'out'>('in', { nonNullable: true }),
    quantity: new FormControl('', { nonNullable: true, validators: [wholeNumber({ required: true, min: 1, max: MAX_QUANTITY })] }),
    reason: new FormControl('', { nonNullable: true, validators: [Validators.required, (c) => (String(c.value ?? '').trim().length >= 3 ? null : { short: true }), Validators.maxLength(240)] }),
  });
  protected readonly message = computed(() => submissionMessage(this.submission));

  constructor() {
    this.form.valueChanges.subscribe(() => this.submission.inputChanged());
    this.form.controls.direction.valueChanges.subscribe((d) => {
      this.direction.set(d);
      // Removing more than is on hand is refused by the server; say so before sending.
      this.form.controls.quantity.setValidators(wholeNumber({ required: true, min: 1, max: d === 'out' ? this.product.quantity : MAX_QUANTITY }));
      this.form.controls.quantity.updateValueAndValidity({ emitEvent: false });
    });
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const quantity = Number(v.quantity);
    const body = { productId: this.product.id, quantityDelta: v.direction === 'out' ? -quantity : quantity, reason: v.reason.trim() };
    const result = await this.submission.run((key) => this.api.adjust(body, key));
    if (result) this.ref.close(result);
  }
}

/** Opens the stock dialogs and confirms the outcome with the figures the server returned. */
@Injectable({ providedIn: 'root' })
export class StockDialogs {
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(Notify);
  private readonly session = inject(SessionStore);

  async receive(product: Product): Promise<StockChange | undefined> {
    const ref = this.dialog.open<ReceiveStockDialog, Product, StockChange>(ReceiveStockDialog, { data: product, width: '480px', autoFocus: 'first-tabbable' });
    const result = await firstValueFrom(ref.afterClosed());
    if (result) {
      const cost = result.product.costMinor;
      const average = cost === undefined || cost === null ? '' : ` Average cost is now ${formatMoney(cost, this.session.money())}.`;
      this.notify.success(`Received ${result.movement.quantityDelta}. ${result.product.quantity} on hand.${average}`);
    }
    return result;
  }

  async adjust(product: Product): Promise<StockChange | undefined> {
    const ref = this.dialog.open<AdjustStockDialog, Product, StockChange>(AdjustStockDialog, { data: product, width: '480px', autoFocus: 'first-tabbable' });
    const result = await firstValueFrom(ref.afterClosed());
    if (result) this.notify.success(`Stock adjusted. ${result.product.quantity} on hand.`);
    return result;
  }
}
