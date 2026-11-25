import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { toApiFailure, type ApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { Organization, OrganizationUpdate } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { parsePercent, percentInput } from '../../../core/money/pricing';
import { Submission } from '../../../core/state/submission';
import { percentValidator, wholeNumber } from '../../../shared/forms/validators';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { SettingsApi } from '../data/settings.api';

const TEXT_FIELDS = ['name', 'legalName', 'taxRegistrationNumber', 'phone', 'email', 'addressLine', 'city', 'countryCode', 'invoiceFooter', 'currencyCode', 'timezone'] as const;
const PERCENT_FIELDS = ['maxMarkupBp', 'defaultMarkupBp', 'defaultMinMarkupBp'] as const;
const NUMBER_FIELDS = ['defaultCreditDays', 'quotationValidityDays', 'lowStockThreshold'] as const;

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

/**
 * W-H1 Business settings. The owner edits; a manager reads (the API refuses edits by others).
 * Only changed fields are sent. Currency and time zone lock once prices or documents use them.
 */
@Component({
  selector: 'app-business-page',
  imports: [ReactiveFormsModule, PageHeader, StateView, Skeleton, MatButton, MatIcon, MatFormField, MatLabel, MatInput, MatError, MatHint, MatSuffix, MatSelect, MatOption, MatSlideToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './business.page.html',
  styleUrl: './settings.scss',
})
export class BusinessPage {
  private readonly api = inject(SettingsApi);
  private readonly session = inject(SessionStore);
  private readonly notify = inject(Notify);
  protected readonly canEdit = computed(() => this.session.can('settings.manage'));
  protected readonly org = signal<Organization | null>(null);
  protected readonly loadFailure = signal<ApiFailure | null>(null);
  protected readonly submission = new Submission();
  protected readonly zones = timeZones();

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    legalName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(160)] }),
    taxRegistrationNumber: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.email, Validators.maxLength(254)] }),
    addressLine: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(240)] }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
    countryCode: new FormControl('', { nonNullable: true, validators: [Validators.pattern(/^[A-Za-z]{2}$/)] }),
    invoiceFooter: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(400)] }),
    currencyCode: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)] }),
    timezone: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    maxMarkupBp: new FormControl('', { nonNullable: true, validators: [percentValidator({ required: true, max: () => 100_000 })] }),
    defaultMarkupBp: new FormControl('', { nonNullable: true, validators: [percentValidator({ required: true, max: () => 100_000 })] }),
    defaultMinMarkupBp: new FormControl('', { nonNullable: true, validators: [percentValidator({ required: true, max: () => 100_000 })] }),
    defaultCreditDays: new FormControl('', { nonNullable: true, validators: [wholeNumber({ required: true, min: 0, max: 365 })] }),
    quotationValidityDays: new FormControl('', { nonNullable: true, validators: [wholeNumber({ required: true, min: 1, max: 365 })] }),
    lowStockThreshold: new FormControl('', { nonNullable: true, validators: [wholeNumber({ required: true, min: 0, max: 1_000_000 })] }),
    allowOfflineSales: new FormControl(false, { nonNullable: true }),
  });
  protected readonly error = computed(() => {
    const f = this.submission.failure();
    return f ? (f.kind === 'validation' ? 'Some fields need attention.' : describeFailure(f)) : null;
  });

  constructor() {
    void this.load();
    this.form.valueChanges.subscribe(() => this.submission.inputChanged());
  }

  protected async load(): Promise<void> {
    this.loadFailure.set(null);
    try {
      this.fill(await this.api.organization());
    } catch (e) {
      this.loadFailure.set(toApiFailure(e));
    }
  }

  private fill(o: Organization): void {
    this.org.set(o);
    this.form.reset({
      name: o.name, legalName: o.legalName ?? '', taxRegistrationNumber: o.taxRegistrationNumber ?? '', phone: o.phone ?? '', email: o.email ?? '',
      addressLine: o.addressLine ?? '', city: o.city ?? '', countryCode: o.countryCode ?? '', invoiceFooter: o.invoiceFooter ?? '',
      currencyCode: o.currencyCode, timezone: o.timezone,
      maxMarkupBp: percentInput(o.maxMarkupBp ?? 0), defaultMarkupBp: percentInput(o.defaultMarkupBp ?? 0), defaultMinMarkupBp: percentInput(o.defaultMinMarkupBp ?? 0),
      defaultCreditDays: String(o.defaultCreditDays ?? ''), quotationValidityDays: String(o.quotationValidityDays ?? ''), lowStockThreshold: String(o.lowStockThreshold ?? ''),
      allowOfflineSales: o.allowOfflineSales ?? false,
    });
    if (!this.canEdit()) this.form.disable({ emitEvent: false });
    else if (o.regionalSettingsLocked) {
      this.form.controls.currencyCode.disable({ emitEvent: false });
      this.form.controls.timezone.disable({ emitEvent: false });
    }
  }

  /** Only what differs from the loaded settings. */
  private changes(): OrganizationUpdate {
    const o = this.org();
    if (!o) return {};
    const v = this.form.getRawValue();
    const out: Record<string, unknown> = {};
    for (const k of TEXT_FIELDS) {
      const control = this.form.controls[k];
      if (control.disabled) continue;
      const now = k === 'countryCode' || k === 'currencyCode' ? v[k].trim().toUpperCase() : v[k].trim();
      const before = (o[k] ?? '') as string;
      if (now !== before) out[k] = now === '' && k !== 'name' ? null : now;
    }
    for (const k of PERCENT_FIELDS) {
      const bp = parsePercent(v[k]);
      if (bp !== null && bp !== o[k]) out[k] = bp;
    }
    for (const k of NUMBER_FIELDS) {
      const n = Number(v[k]);
      if (n !== o[k]) out[k] = n;
    }
    if (v.allowOfflineSales !== (o.allowOfflineSales ?? false)) out['allowOfflineSales'] = v.allowOfflineSales;
    return out as OrganizationUpdate;
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const changes = this.changes();
    if (Object.keys(changes).length === 0) {
      this.notify.success('Nothing changed.');
      return;
    }
    const saved = await this.submission.run(() => this.api.updateOrganization(changes));
    if (saved) {
      this.fill(saved);
      this.notify.success('Business settings saved.');
      return;
    }
    const f = this.submission.failure();
    if (f?.kind === 'validation') {
      for (const field of Object.keys(f.fields)) {
        const c = this.form.get(field);
        c?.setErrors({ server: true });
        c?.markAsTouched();
      }
    }
  }
}
