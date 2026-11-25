import { ChangeDetectionStrategy, Component, Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { type AbstractControl, FormControl, FormGroup, ReactiveFormsModule, type ValidationErrors } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import type { Product } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatBasisPoints, formatMoney, parseMoney } from '../../../core/money/money';
import { markupFromPrice } from '../../../core/money/pricing';
import { moneyValidator, wholeNumber } from '../../../shared/forms/validators';

export interface PriceEditorData {
  /** The product as just read from the server (limits, stock and — for managers — cost). */
  product: Product;
  quantity: number;
  unitPriceMinor: number;
  belowMinimumReason: string | null;
  /** True when editing a line already in the cart. */
  editing: boolean;
}

export interface PriceEditorResult {
  quantity: number;
  unitPriceMinor: number;
  belowMinimumReason: string | null;
}

/**
 * W-D2 Price editor. The limits shown are the product's; the server checks them again when the
 * cart is previewed and when the sale is confirmed. Cost, profit and markup appear only for roles
 * that may see cost (rule P7).
 */
@Component({
  selector: 'app-price-editor',
  imports: [ReactiveFormsModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, MatIconButton, MatIcon, MatFormField, MatLabel, MatInput, MatError, MatHint, MatSlideToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.product.name }}</h2>
    <form [formGroup]="form" (ngSubmit)="accept()" novalidate>
      <mat-dialog-content>
        <p class="t-muted context">{{ data.product.sku }} · {{ data.product.quantity }} available</p>
        <div class="qty">
          <button matIconButton type="button" aria-label="One fewer" (click)="step(-1)" [disabled]="quantity() <= 1"><mat-icon>remove</mat-icon></button>
          <mat-form-field class="qty-field">
            <mat-label>Quantity</mat-label>
            <input matInput formControlName="quantity" inputmode="numeric" autocomplete="off" data-testid="editor-quantity" />
            <mat-error>From 1 to {{ data.product.quantity }}.</mat-error>
          </mat-form-field>
          <button matIconButton type="button" aria-label="One more" (click)="step(1)" [disabled]="quantity() >= data.product.quantity"><mat-icon>add</mat-icon></button>
        </div>
        <mat-form-field class="wide">
          <mat-label>Unit price</mat-label>
          <input matInput formControlName="price" inputmode="decimal" autocomplete="off" data-testid="editor-price" cdkFocusInitial />
          <mat-hint>Lowest {{ money(data.product.floorPriceMinor) }} · Highest {{ money(data.product.ceilingPriceMinor) }}</mat-hint>
          @if (form.controls.price.hasError('money') || form.controls.price.hasError('required')) {
            <mat-error>Enter an amount, for example 3,640.00.</mat-error>
          }
        </mat-form-field>
        @if (form.hasError('belowFloor')) {
          <p class="error" role="alert" data-testid="editor-below">Below the lowest price ({{ money(data.product.floorPriceMinor) }}).</p>
        }
        @if (form.hasError('aboveCeiling')) {
          <p class="error" role="alert" data-testid="editor-above">Above the highest price ({{ money(data.product.ceilingPriceMinor) }}).</p>
        }
        @if (maySellBelow && isBelowFloor()) {
          <mat-slide-toggle formControlName="override" data-testid="editor-override">Sell below the lowest price</mat-slide-toggle>
          @if (form.controls.override.value) {
            <mat-form-field class="wide">
              <mat-label>Reason (recorded)</mat-label>
              <input matInput formControlName="reason" maxlength="240" autocomplete="off" data-testid="editor-reason" />
              <mat-error>Give a reason of at least 3 characters.</mat-error>
            </mat-form-field>
          }
        }
        <dl class="figures">
          <div><dt>Line total</dt><dd class="t-money" data-testid="editor-total">{{ lineTotal() }}</dd></div>
          @if (cost(); as c) {
            <div><dt>Cost</dt><dd class="t-money">{{ c.cost }}</dd></div>
            <div><dt>Profit</dt><dd class="t-money" [class.loss]="c.loss">{{ c.profit }}</dd></div>
            <div><dt>Markup</dt><dd>{{ c.markup }}</dd></div>
          }
        </dl>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" (click)="ref.close()">Cancel</button>
        <button matButton="filled" type="submit" data-testid="editor-accept">{{ data.editing ? 'Update line' : 'Add to sale' }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    form { display: contents; }
    mat-dialog-content { display: flex; flex-direction: column; gap: var(--space-3); }
    .context { margin: 0; }
    .qty { display: flex; align-items: center; gap: var(--space-2); }
    .qty-field { width: 140px; }
    .wide { width: 100%; }
    .error { margin: 0; color: var(--color-error); }
    .figures { margin: 0; display: grid; gap: var(--space-1);
      div { display: flex; justify-content: space-between; }
      dt { color: var(--color-text-muted); }
      dd { margin: 0; }
      .loss { color: var(--status-danger-fg); }
    }
  `,
})
export class PriceEditorDialog {
  protected readonly data = inject<PriceEditorData>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<PriceEditorDialog, PriceEditorResult>>(MatDialogRef);
  private readonly session = inject(SessionStore);
  protected readonly maySellBelow = this.session.can('sale.below_minimum');
  private readonly exponent = () => this.session.money().exponent;

  protected readonly form = new FormGroup(
    {
      quantity: new FormControl(String(this.data.quantity), { nonNullable: true, validators: [wholeNumber({ required: true, min: 1, max: Math.max(1, this.data.product.quantity) })] }),
      price: new FormControl(formatMoney(this.data.unitPriceMinor, this.session.money(), { withCode: false }), { nonNullable: true, validators: [moneyValidator(this.exponent, { required: true, min: 0 })] }),
      override: new FormControl(this.data.belowMinimumReason !== null, { nonNullable: true }),
      reason: new FormControl(this.data.belowMinimumReason ?? '', { nonNullable: true }),
    },
    { validators: [(g) => this.limits(g)] },
  );
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly quantity = computed(() => Number(this.values().quantity) || 0);
  private readonly priceMinor = computed(() => parseMoney(this.values().price ?? '', { exponent: this.exponent() }));
  protected readonly isBelowFloor = computed(() => {
    const p = this.priceMinor();
    return p !== null && p < this.data.product.floorPriceMinor;
  });

  private limits(group: AbstractControl): ValidationErrors | null {
    const v = group.value as { price?: string; override?: boolean; reason?: string };
    const price = parseMoney(v.price ?? '', { exponent: this.exponent() });
    if (price === null) return null;
    if (price > this.data.product.ceilingPriceMinor) return { aboveCeiling: true };
    if (price < this.data.product.floorPriceMinor) {
      if (!this.maySellBelow || !v.override) return { belowFloor: true };
      if ((v.reason ?? '').trim().length < 3) {
        group.get('reason')?.setErrors({ reason: true });
        return { reason: true };
      }
    }
    return null;
  }

  protected money(minor: number): string {
    return formatMoney(minor, this.session.money());
  }

  /** Display only: quantity × the entered price. The cart shows the server's figures. */
  protected readonly lineTotal = computed(() => {
    const p = this.priceMinor();
    return p === null ? '—' : this.money(Number(BigInt(p) * BigInt(this.quantity())));
  });

  protected readonly cost = computed(() => {
    const unitCost = this.data.product.costMinor;
    const price = this.priceMinor();
    if (unitCost === undefined || unitCost === null || price === null) return null;
    const qty = BigInt(this.quantity());
    const profit = (BigInt(price) - BigInt(unitCost)) * qty;
    return { cost: this.money(Number(BigInt(unitCost) * qty)), profit: this.money(Number(profit)), loss: profit < 0n, markup: formatBasisPoints(markupFromPrice(unitCost, price)) };
  });

  protected step(delta: number): void {
    const next = Math.min(Math.max(1, this.quantity() + delta), this.data.product.quantity);
    this.form.controls.quantity.setValue(String(next));
  }

  protected accept(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const price = parseMoney(v.price, { exponent: this.exponent() }) ?? 0;
    const below = price < this.data.product.floorPriceMinor;
    this.ref.close({ quantity: Number(v.quantity), unitPriceMinor: price, belowMinimumReason: below && v.override ? v.reason.trim() : null });
  }
}

@Injectable({ providedIn: 'root' })
export class PriceEditor {
  private readonly dialog = inject(MatDialog);

  async open(data: PriceEditorData): Promise<PriceEditorResult | undefined> {
    const ref = this.dialog.open<PriceEditorDialog, PriceEditorData, PriceEditorResult>(PriceEditorDialog, { data, width: '440px', maxWidth: '96vw', autoFocus: '[data-testid="editor-price"]' });
    return firstValueFrom(ref.afterClosed());
  }
}
