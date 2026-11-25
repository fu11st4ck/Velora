import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { toApiFailure, type ApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { TaxRate } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatBasisPoints } from '../../../core/money/money';
import { parsePercent } from '../../../core/money/pricing';
import { Confirm } from '../../../shared/ui/confirm-dialog';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { StatusPill } from '../../../shared/ui/status-pill';
import { SettingsApi } from '../data/settings.api';

/** W-H2 Tax rates. A rate's percentage never changes once created (documents keep a snapshot anyway). */
@Component({
  selector: 'app-tax-rates-page',
  imports: [FormsModule, PageHeader, StateView, Skeleton, StatusPill, MatButton, MatCheckbox, MatFormField, MatLabel, MatSuffix, MatInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header heading="Tax rates" [subtitle]="canEdit() ? 'The default rate is preselected on new sales.' : 'Only the owner can change tax rates.'" />
    @if (failure(); as f) {
      <app-state-view kind="error" heading="Could not load tax rates" [message]="message(f)" actionLabel="Try again" (action)="load()" />
    } @else if (rates(); as list) {
      @if (canEdit()) {
        <form class="add card" (ngSubmit)="add()" aria-label="Add a tax rate">
          <mat-form-field><mat-label>Name</mat-label><input matInput name="name" [(ngModel)]="newName" maxlength="60" data-testid="tax-name" /></mat-form-field>
          <mat-form-field><mat-label>Rate</mat-label><input matInput name="rate" [(ngModel)]="newRate" inputmode="decimal" data-testid="tax-rate" /><span matTextSuffix>%</span></mat-form-field>
          <mat-checkbox name="default" [(ngModel)]="newDefault">Make default</mat-checkbox>
          <button matButton="filled" type="submit" [disabled]="busy()" data-testid="tax-add">Add rate</button>
          @if (addError(); as e) { <p class="error" role="alert" data-testid="tax-error">{{ e }}</p> }
        </form>
      }
      <div class="table-wrap">
        <table class="table" data-testid="tax-table">
          <caption class="visually-hidden">Tax rates</caption>
          <thead><tr><th scope="col">Name</th><th scope="col" class="num">Rate</th><th scope="col">Status</th>@if (canEdit()) {<th scope="col"><span class="visually-hidden">Actions</span></th>}</tr></thead>
          <tbody>
            @for (r of list; track r.id) {
              <tr data-testid="tax-row">
                <td>
                  @if (editing() === r.id) {
                    <mat-form-field class="rename"><mat-label>Name</mat-label><input matInput [(ngModel)]="editName" maxlength="60" data-testid="tax-rename-input" (keydown.enter)="rename(r)" (keydown.escape)="editing.set(null)" /></mat-form-field>
                  } @else {
                    {{ r.name }}
                  }
                </td>
                <td class="num">{{ percent(r.rateBp) }}</td>
                <td>
                  @if (r.isDefault) { <app-status-pill label="Default" tone="success" /> }
                  @else if (!r.isActive) { <app-status-pill label="Not in use" tone="neutral" /> }
                  @else { <app-status-pill label="In use" tone="neutral" /> }
                </td>
                @if (canEdit()) {
                  <td class="actions">
                    @if (editing() === r.id) {
                      <button matButton type="button" (click)="editing.set(null)">Cancel</button>
                      <button matButton="filled" type="button" (click)="rename(r)" [disabled]="busy()" data-testid="tax-rename-save">Save</button>
                    } @else {
                      <button matButton type="button" (click)="startRename(r)" [disabled]="busy()">Rename</button>
                      @if (r.isActive && !r.isDefault) {
                        <button matButton type="button" (click)="change(r, { isDefault: true }, r.name + ' is now the default.')" [disabled]="busy()" data-testid="tax-make-default">Make default</button>
                        <button matButton type="button" (click)="stop(r)" [disabled]="busy()" data-testid="tax-stop">Stop using</button>
                      }
                      @if (!r.isActive) {
                        <button matButton type="button" (click)="change(r, { isActive: true }, r.name + ' can be used again.')" [disabled]="busy()">Use again</button>
                      }
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <app-skeleton height="200px" />
    }
  `,
  styleUrl: './settings.scss',
  styles: `.add { flex-direction: row; align-items: center; } .add .error { flex-basis: 100%; } .rename { width: 220px; }`,
})
export class TaxRatesPage {
  private readonly api = inject(SettingsApi);
  private readonly session = inject(SessionStore);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  protected readonly canEdit = computed(() => this.session.can('settings.manage'));
  protected readonly rates = signal<TaxRate[] | null>(null);
  protected readonly failure = signal<ApiFailure | null>(null);
  protected readonly busy = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly addError = signal<string | null>(null);
  protected newName = '';
  protected newRate = '';
  protected newDefault = false;
  protected editName = '';

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.failure.set(null);
    try {
      const rates = await this.api.taxRates();
      this.rates.set([...rates].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)));
    } catch (e) {
      this.failure.set(toApiFailure(e));
    }
  }

  protected percent(bp: number): string {
    return formatBasisPoints(bp);
  }
  protected message(f: ApiFailure): string {
    return describeFailure(f);
  }

  private async run(task: () => Promise<unknown>, success: string): Promise<boolean> {
    this.busy.set(true);
    try {
      await task();
      this.notify.success(success);
      await this.load();
      return true;
    } catch (e) {
      this.notify.error(describeFailure(toApiFailure(e)));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async add(): Promise<void> {
    const name = this.newName.trim();
    const rateBp = parsePercent(this.newRate);
    if (!name) return this.addError.set('Enter a name, for example VAT.');
    if (rateBp === null || rateBp > 10_000) return this.addError.set('Enter a rate from 0 to 100%, for example 5.');
    this.addError.set(null);
    const ok = await this.run(() => this.api.createTaxRate({ name, rateBp, isDefault: this.newDefault }), `${name} added.`);
    if (ok) {
      this.newName = '';
      this.newRate = '';
      this.newDefault = false;
    }
  }

  protected startRename(r: TaxRate): void {
    this.editName = r.name;
    this.editing.set(r.id);
  }

  protected async rename(r: TaxRate): Promise<void> {
    const name = this.editName.trim();
    if (!name || name === r.name) return this.editing.set(null);
    if (await this.run(() => this.api.updateTaxRate(r.id, { name }), 'Tax rate renamed.')) this.editing.set(null);
  }

  protected async change(r: TaxRate, body: { isDefault?: boolean; isActive?: boolean }, success: string): Promise<void> {
    await this.run(() => this.api.updateTaxRate(r.id, body), success);
  }

  protected async stop(r: TaxRate): Promise<void> {
    const yes = await this.confirm.ask({ title: `Stop using ${r.name}?`, message: 'It will no longer be offered on new sales. Documents that used it keep it.', confirmLabel: 'Stop using' });
    if (yes) await this.change(r, { isActive: false }, `${r.name} is no longer offered.`);
  }
}
