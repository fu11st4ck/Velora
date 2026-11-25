import { DIALOG_DEFAULTS } from '../../../shared/ui/dialog-defaults';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatFormField, MatLabel, MatPrefix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressBar } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { describeFailure } from '../../../core/api/messages';
import { toApiFailure } from '../../../core/api/api-failure';
import type { Customer } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { CustomerForm } from './customer-form';
import { CustomersApi, customerLabel } from '../data/customers.api';

/** W-D3 Customer picker: search, or add a customer without leaving the sale. */
@Component({
  selector: 'app-customer-picker',
  imports: [FormsModule, CustomerForm, MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, MatFormField, MatLabel, MatPrefix, MatInput, MatIcon, MatProgressBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ creating() ? 'New customer' : 'Choose customer' }}</h2>
    <mat-dialog-content>
      @if (creating()) {
        <app-customer-form [compact]="true" (saved)="ref.close($event)" (useExisting)="ref.close($event)" (cancelled)="creating.set(false)" />
      } @else {
        <mat-form-field class="search">
          <mat-label>Name, company or phone</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input matInput type="search" [ngModel]="text()" (ngModelChange)="onSearch($event)" autocomplete="off" data-testid="picker-search" cdkFocusInitial />
        </mat-form-field>
        @if (loading()) {
          <mat-progress-bar mode="indeterminate" aria-label="Searching" />
        }
        @if (error(); as e) {
          <p class="error" role="alert">{{ e }}</p>
        }
        <ul class="results" role="listbox" aria-label="Customers">
          @for (c of results(); track c.id) {
            <li>
              <button type="button" class="result" role="option" aria-selected="false" (click)="ref.close(c)" data-testid="picker-result">
                <span class="name">{{ label(c) }}</span>
                <span class="t-body-sm t-muted">{{ c.mobile ?? c.email ?? '' }}</span>
              </button>
            </li>
          } @empty {
            @if (text().trim() && !loading()) {
              <li class="t-muted empty">No customer matches “{{ text().trim() }}”.</li>
            }
          }
        </ul>
      }
    </mat-dialog-content>
    @if (!creating()) {
      <mat-dialog-actions align="end">
        <button matButton type="button" (click)="ref.close()">Cancel</button>
        @if (canCreate) {
          <button matButton="outlined" type="button" (click)="creating.set(true)" data-testid="picker-new"><mat-icon>person_add</mat-icon>New customer</button>
        }
      </mat-dialog-actions>
    }
  `,
  styles: `
    .search { width: 100%; }
    .error { color: var(--color-error); }
    .results { list-style: none; margin: var(--space-2) 0 0; padding: 0; max-height: 360px; overflow-y: auto; }
    .result { display: flex; flex-direction: column; align-items: flex-start; width: 100%; padding: var(--space-3); border: 0; border-radius: var(--radius-md); background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer;
      &:hover, &:focus-visible { background: var(--color-primary-container); color: var(--color-on-primary-container); }
      &:focus-visible { outline: 2px solid var(--color-focus); }
    }
    .name { font-weight: 600; }
    .empty { padding: var(--space-3); }
  `,
})
export class CustomerPickerDialog {
  protected readonly ref = inject<MatDialogRef<CustomerPickerDialog, Customer>>(MatDialogRef);
  private readonly api = inject(CustomersApi);
  protected readonly canCreate = inject(SessionStore).can('customer.write');
  protected readonly text = signal(inject<{ query?: string } | null>(MAT_DIALOG_DATA)?.query ?? '');
  protected readonly results = signal<Customer[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly creating = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  constructor() {
    void this.search();
  }

  protected label(c: Customer): string {
    return customerLabel(c);
  }

  protected onSearch(text: string): void {
    this.text.set(text);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.search(), 250);
  }

  private async search(): Promise<void> {
    const generation = ++this.generation;
    this.loading.set(true);
    this.error.set(null);
    try {
      const q = this.text().trim();
      const page = await this.api.list({ q: q || undefined, sort: q ? 'name' : '-createdAt', limit: 20 }, null);
      if (generation === this.generation) this.results.set(page.data);
    } catch (e) {
      if (generation === this.generation) this.error.set(describeFailure(toApiFailure(e)));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
}

@Injectable({ providedIn: 'root' })
export class CustomerPicker {
  private readonly dialog = inject(MatDialog);

  async choose(): Promise<Customer | undefined> {
    const ref = this.dialog.open<CustomerPickerDialog, { query?: string }, Customer>(CustomerPickerDialog, { ...DIALOG_DEFAULTS, width: '560px', maxWidth: '96vw', autoFocus: 'first-tabbable', data: {} });
    return firstValueFrom(ref.afterClosed());
  }
}
