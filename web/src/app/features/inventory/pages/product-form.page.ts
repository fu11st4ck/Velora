import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { type AbstractControl, FormControl, FormGroup, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { toApiFailure, type ApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { Product, ProductCreate, ProductUpdate } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatBasisPoints, formatMoney, parseMoney } from '../../../core/money/money';
import { parsePercent, percentInput, priceFromMarkup } from '../../../core/money/pricing';
import { Submission } from '../../../core/state/submission';
import { moneyValidator, percentValidator, wholeNumber } from '../../../shared/forms/validators';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { InventoryApi } from '../data/inventory.api';

const SKU = /^[A-Za-z0-9._-]+$/;
const WEIGHT = /^\d{1,9}(\.\d{1,3})?$/;
const MAX_QUANTITY = 1_000_000;

/** Weight value and unit come together or not at all. */
function weightPair(group: AbstractControl): ValidationErrors | null {
  const value = String(group.get('weightValue')?.value ?? '').trim();
  const unit = group.get('weightUnit')?.value;
  return value && !unit ? { weightUnit: true } : null;
}

/** Minimum markup must not exceed the default (business rule P2; the server enforces it). */
function markupOrder(group: AbstractControl): ValidationErrors | null {
  const def = parsePercent(String(group.get('defaultMarkup')?.value ?? ''));
  const min = parsePercent(String(group.get('minMarkup')?.value ?? ''));
  return def !== null && min !== null && min > def ? { markupOrder: true } : null;
}

/**
 * W-C3 New / edit product. A page rather than the drawer in the screen spec: the form has three
 * sections and a price preview, which fit poorly in a drawer at 1024 px (deviation noted in the spec).
 */
@Component({
  selector: 'app-product-form-page',
  imports: [ReactiveFormsModule, RouterLink, PageHeader, StateView, Skeleton, MatButton, MatIcon, MatFormField, MatLabel, MatInput, MatError, MatHint, MatSuffix, MatSelect, MatOption],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-form.page.html',
  styleUrl: './product-form.page.scss',
})
export class ProductFormPage {
  /** Route parameter; absent on /inventory/new. */
  readonly id = input<string>();
  private readonly api = inject(InventoryApi);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly notify = inject(Notify);

  protected readonly editing = computed(() => !!this.id());
  protected readonly original = signal<Product | null>(null);
  protected readonly loadFailure = signal<ApiFailure | null>(null);
  protected readonly conflict = signal(false);
  protected readonly submission = new Submission();
  protected readonly currency = computed(() => this.session.money().currencyCode);
  private readonly exponent = () => this.session.money().exponent;
  /** Organization maximum markup (present for roles that see cost). */
  protected readonly maxMarkupBp = computed(() => this.session.me()?.settings.maxMarkupBp ?? null);

  protected readonly form = new FormGroup(
    {
      name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120), (c) => (String(c.value).trim() ? null : { required: true })] }),
      sku: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40), Validators.pattern(SKU)] }),
      barcode: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(64)] }),
      description: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] }),
      weightValue: new FormControl('', { nonNullable: true, validators: [Validators.pattern(WEIGHT)] }),
      weightUnit: new FormControl<'G' | 'KG' | ''>('', { nonNullable: true }),
      cost: new FormControl('', { nonNullable: true, validators: [moneyValidator(this.exponent, { required: true, min: 0 })] }),
      defaultMarkup: new FormControl('', { nonNullable: true, validators: [percentValidator({ required: true, max: () => this.maxMarkupBp() })] }),
      minMarkup: new FormControl('', { nonNullable: true, validators: [percentValidator({ required: true })] }),
      openingQuantity: new FormControl('0', { nonNullable: true, validators: [wholeNumber({ required: true, min: 0, max: MAX_QUANTITY })] }),
      reorderLevel: new FormControl('', { nonNullable: true, validators: [wholeNumber({ min: 0, max: MAX_QUANTITY })] }),
      supplierName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
      referenceNote: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(240)] }),
    },
    { validators: [weightPair, markupOrder] },
  );
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  /** Display-only preview; the saved product shows the prices the server calculated. */
  protected readonly preview = computed(() => {
    const v = { ...this.form.getRawValue(), ...this.values() };
    const cost = this.editing() ? (this.original()?.costMinor ?? null) : parseMoney(v.cost ?? '', { exponent: this.exponent() });
    const def = parsePercent(v.defaultMarkup ?? '');
    const min = parsePercent(v.minMarkup ?? '');
    if (cost === null || def === null || min === null) return null;
    const max = this.maxMarkupBp();
    const money = (minor: number) => formatMoney(minor, this.session.money());
    return {
      list: money(priceFromMarkup(cost, def)),
      floor: money(priceFromMarkup(cost, min)),
      ceiling: max === null ? null : money(priceFromMarkup(cost, Math.max(max, def))),
    };
  });
  protected readonly maxLabel = computed(() => {
    const max = this.maxMarkupBp();
    return max === null ? null : formatBasisPoints(max);
  });
  protected readonly hasOpening = computed(() => {
    const q = Number(this.values().openingQuantity ?? 0);
    return Number.isInteger(q) && q > 0;
  });
  protected readonly message = computed(() => {
    const f = this.submission.failure();
    if (!f || this.conflict()) return null;
    if (this.submission.unconfirmed()) return 'The connection dropped before Velora confirmed this. Save again — the product will not be created twice.';
    if (f.kind === 'validation') return 'Some fields need attention.';
    return describeFailure(f);
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) untracked(() => void this.load(id));
    });
    this.form.valueChanges.subscribe(() => this.submission.inputChanged());
  }

  protected async load(id: string): Promise<void> {
    this.loadFailure.set(null);
    this.original.set(null);
    try {
      const p = await this.api.product(id);
      this.original.set(p);
      this.conflict.set(false);
      this.form.reset({
        name: p.name,
        sku: p.sku,
        barcode: p.barcode ?? '',
        description: p.description ?? '',
        weightValue: p.weight?.value ?? '',
        weightUnit: p.weight?.unit ?? '',
        cost: p.costMinor === undefined || p.costMinor === null ? '' : formatMoney(p.costMinor, this.session.money(), { withCode: false }),
        defaultMarkup: p.defaultMarkupBp === undefined ? '' : percentInput(p.defaultMarkupBp),
        minMarkup: p.minMarkupBp === undefined ? '' : percentInput(p.minMarkupBp),
        openingQuantity: '0',
        reorderLevel: p.reorderLevel === null || p.reorderLevel === undefined ? '' : String(p.reorderLevel),
        supplierName: '',
        referenceNote: '',
      });
      // Cost changes only through receipts (weighted average); opening stock exists only at creation.
      for (const name of ['cost', 'openingQuantity', 'supplierName', 'referenceNote'] as const) this.form.controls[name].disable();
    } catch (error) {
      this.loadFailure.set(toApiFailure(error));
    }
  }

  private common() {
    const v = this.form.getRawValue();
    const weight = v.weightValue.trim() && v.weightUnit ? { value: v.weightValue.trim(), unit: v.weightUnit } : null;
    return {
      name: v.name.trim(),
      barcode: v.barcode.trim() || null,
      description: v.description.trim() || null,
      weight,
      defaultMarkupBp: parsePercent(v.defaultMarkup) ?? 0,
      minMarkupBp: parsePercent(v.minMarkup) ?? 0,
      reorderLevel: v.reorderLevel.trim() === '' ? null : Number(v.reorderLevel),
    };
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const original = this.original();
    let saved: Product | undefined;
    if (original) {
      const body: ProductUpdate = { version: original.version, sku: v.sku.trim() || original.sku, ...this.common() };
      saved = await this.submission.run(() => this.api.update(original.id, body));
    } else {
      const body: ProductCreate = {
        ...this.common(),
        sku: v.sku.trim() || null,
        costMinor: parseMoney(v.cost, { exponent: this.exponent() }) ?? 0,
        openingQuantity: Number(v.openingQuantity),
        supplierName: v.supplierName.trim() || null,
        referenceNote: v.referenceNote.trim() || null,
      };
      saved = await this.submission.run((key) => this.api.create(body, key));
    }
    if (saved) {
      this.notify.success(original ? `${saved.name} saved.` : `${saved.name} created.`);
      void this.router.navigate(['/inventory', saved.id]);
      return;
    }
    this.showServerErrors();
  }

  /** Puts the server's verdict next to the field it concerns. */
  private showServerErrors(): void {
    const f = this.submission.failure();
    if (!f) return;
    if (f.kind === 'business') {
      if (f.code === 'VERSION_CONFLICT') this.conflict.set(true);
      if (f.code === 'SKU_TAKEN') this.form.controls.sku.setErrors({ taken: true });
      if (f.code === 'BARCODE_TAKEN') this.form.controls.barcode.setErrors({ taken: true });
    }
    if (f.kind === 'validation') {
      for (const field of Object.keys(f.fields)) {
        const name = field === 'costMinor' ? 'cost' : field === 'defaultMarkupBp' ? 'defaultMarkup' : field === 'minMarkupBp' ? 'minMarkup' : field.startsWith('weight') ? 'weightValue' : field;
        const control = this.form.get(name);
        if (control) {
          control.setErrors({ server: true });
          control.markAsTouched();
        }
      }
    }
  }

  protected reloadAfterConflict(): void {
    const id = this.id();
    if (id) void this.load(id);
  }

  protected cancelLink(): string[] {
    const id = this.id();
    return id ? ['/inventory', id] : ['/inventory'];
  }
}
