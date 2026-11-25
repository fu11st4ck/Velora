import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { toApiFailure, type ApiFailure } from '../../../core/api/api-failure';
import type { Customer } from '../../../core/api/types';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { CustomerForm } from '../components/customer-form';
import { CustomersApi, customerLabel } from '../data/customers.api';

/** W-E3 New / edit customer — a page (like the product form), see the screen spec. */
@Component({
  selector: 'app-customer-form-page',
  imports: [PageHeader, StateView, Skeleton, CustomerForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header [heading]="id() ? 'Edit customer' : 'New customer'" />
    @if (loadFailure(); as f) {
      <app-state-view [kind]="f.kind === 'notFound' ? 'notFound' : 'error'" [heading]="f.kind === 'notFound' ? 'Customer not found' : 'Could not load this customer'" actionLabel="Try again" (action)="load()" />
    } @else if (id() && !customer()) {
      <app-skeleton height="360px" />
    } @else {
      <div class="card">
        <app-customer-form [customer]="customer()" (saved)="saved($event)" (useExisting)="open($event)" (cancelled)="back()" />
      </div>
    }
  `,
  styles: `.card { max-width: 760px; padding: var(--space-5); border: 1px solid var(--color-line); border-radius: var(--radius-lg); background: var(--color-surface); }`,
})
export class CustomerFormPage {
  readonly id = input<string>();
  private readonly api = inject(CustomersApi);
  private readonly router = inject(Router);
  private readonly notify = inject(Notify);
  protected readonly customer = signal<Customer | null>(null);
  protected readonly loadFailure = signal<ApiFailure | null>(null);

  constructor() {
    effect(() => {
      if (this.id()) untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    const id = this.id();
    if (!id) return;
    this.loadFailure.set(null);
    try {
      this.customer.set(await this.api.get(id));
    } catch (error) {
      this.loadFailure.set(toApiFailure(error));
    }
  }

  protected saved(c: Customer): void {
    this.notify.success(this.id() ? `${customerLabel(c)} saved.` : `${customerLabel(c)} added.`);
    void this.router.navigate(['/customers', c.id]);
  }

  protected open(c: Customer): void {
    void this.router.navigate(['/customers', c.id]);
  }

  protected back(): void {
    const id = this.id();
    void this.router.navigate(id ? ['/customers', id] : ['/customers']);
  }
}
