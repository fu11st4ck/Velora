import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { Confirm } from '../shared/ui/confirm-dialog';
import { KpiTile } from '../shared/ui/kpi-tile';
import { Notify } from '../shared/ui/notify';
import { PageHeader } from '../shared/ui/page-header';
import { Skeleton } from '../shared/ui/skeleton';
import { StateView } from '../shared/ui/state-view';
import { StatusPill } from '../shared/ui/status-pill';

/** Design-system review page. Registered in development builds only (environment.devTools). */
@Component({
  selector: 'app-dev-ui-page',
  imports: [PageHeader, StatusPill, KpiTile, StateView, Skeleton, MatButton, MatFormField, MatLabel, MatInput, MatHint],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header heading="Design system" overline="Development only" subtitle="Every shared component in each of its states." />
    <section>
      <h2 class="t-title-md">Typography</h2>
      <p class="t-display">Display 32</p>
      <p class="t-title-lg">Title large 24</p>
      <p class="t-title-md">Title medium 18</p>
      <p class="t-overline">Overline</p>
      <p>Body 14 — The quick brown fox.</p>
      <p class="t-body-sm t-muted">Body small, muted</p>
      <p class="t-money-lg">AED 150,850.00</p>
    </section>
    <section>
      <h2 class="t-title-md">Status</h2>
      <div class="row">
        <app-status-pill label="Paid" tone="success" />
        <app-status-pill label="Partially paid" tone="warning" />
        <app-status-pill label="Overdue" tone="danger" />
        <app-status-pill label="Quotation" />
      </div>
    </section>
    <section>
      <h2 class="t-title-md">Buttons</h2>
      <div class="row">
        <button matButton="filled" type="button">Filled</button>
        <button matButton="tonal" type="button">Tonal</button>
        <button matButton="outlined" type="button">Outlined</button>
        <button matButton type="button">Text</button>
        <button matButton="filled" type="button" disabled>Disabled</button>
      </div>
    </section>
    <section>
      <h2 class="t-title-md">Form field</h2>
      <mat-form-field appearance="outline">
        <mat-label>Customer name</mat-label>
        <input matInput />
        <mat-hint>Hints sit under the field.</mat-hint>
      </mat-form-field>
    </section>
    <section>
      <h2 class="t-title-md">KPI tiles</h2>
      <div class="grid">
        <app-kpi-tile label="Today's sales" value="AED 10,694.25" [lines]="['2 invoices', 'Up 12.4% on yesterday']" />
        <app-kpi-tile label="Outstanding" value="AED 12,500.00" [lines]="['3 invoices']" alert="Overdue AED 3,500.00" />
        <app-kpi-tile label="This month's profit" [value]="null" />
      </div>
    </section>
    <section>
      <h2 class="t-title-md">Feedback</h2>
      <div class="row">
        <button matButton="outlined" type="button" (click)="notify.success('Saved.')">Toast</button>
        <button matButton="outlined" type="button" (click)="ask()">Confirm dialog</button>
        <span>Last answer: {{ answer() }}</span>
      </div>
    </section>
    <section>
      <h2 class="t-title-md">States</h2>
      <app-skeleton height="48px" />
      <app-state-view heading="No products yet" message="Products appear here once they are added." actionLabel="Add product" />
      <app-state-view kind="error" heading="Could not load" message="No connection. Check your internet and try again." actionLabel="Try again" />
      <app-state-view kind="forbidden" heading="You don't have access to this" />
    </section>
  `,
  styles: `
    section { margin-bottom: var(--space-8); }
    h2 { margin-bottom: var(--space-3); }
    p { margin: 0 0 var(--space-2); }
    .row { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--space-4); }
  `,
})
export class DevUiPage {
  protected readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  protected readonly answer = signal('—');

  protected async ask(): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Cancel this invoice?', message: 'Stock is restored for 2 items.\nAED 3,822.00 is recorded as refunded.', confirmLabel: 'Cancel invoice', danger: true });
    this.answer.set(ok ? 'confirmed' : 'kept');
  }
}
