import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { toApiFailure } from '../../core/api/api-failure';
import { describeFailure } from '../../core/api/messages';
import type { DashboardSummary, DocumentSummary, Envelope } from '../../core/api/types';
import { SessionStore } from '../../core/auth/session.store';
import { formatCalendarDate, formatInstant, greeting } from '../../core/dates/dates';
import { formatBasisPoints, formatMoney } from '../../core/money/money';
import { EntityVersions } from '../../core/state/entity-versions';
import { documentStatus } from '../../shared/domain/document-status';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { Skeleton } from '../../shared/ui/skeleton';
import { StateView } from '../../shared/ui/state-view';
import { StatusPill } from '../../shared/ui/status-pill';

interface Tile {
  label: string;
  value: string | null;
  lines: string[];
  alert: string | null;
  /** Where the figure is explained in detail; only for pages that exist. */
  link?: { path: string; query?: Record<string, string> };
}

/** W-B1 Dashboard (docs/web-screen-specifications.md). Sales staff see their own figures and no cost-based ones. */
@Component({
  selector: 'app-dashboard-page',
  imports: [PageHeader, KpiTile, StatusPill, StateView, Skeleton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage {
  private readonly session = inject(SessionStore);
  private readonly versions = inject(EntityVersions);

  protected readonly summary = httpResource<Envelope<DashboardSummary>>(() => {
    // Refetch whenever a sale, payment or stock change happens anywhere in the app.
    this.versions.of('documents')();
    this.versions.of('stock')();
    this.versions.of('products')();
    return `${environment.apiBaseUrl}/dashboard/summary`;
  });

  protected readonly data = computed(() => (this.summary.hasValue() ? this.summary.value().data : null));
  protected readonly failure = computed(() => {
    const error = this.summary.error();
    return error ? describeFailure(toApiFailure(error)) : null;
  });
  protected readonly organization = computed(() => this.session.me()?.membership.organization.name ?? '');
  protected readonly hello = computed(() => {
    const me = this.session.me();
    if (!me) return '';
    const first = me.user.fullName.trim().split(/\s+/)[0];
    return `${greeting(new Date(), me.settings.timezone)}, ${first}`;
  });

  private money(minor: number): string {
    return formatMoney(minor, this.session.money());
  }

  private plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  protected readonly tiles = computed<Tile[]>(() => {
    const d = this.data();
    if (!d) return [];
    const change = d.todaySales.changeBp;
    return [
      {
        label: "Today's sales",
        value: this.money(d.todaySales.invoicedMinor),
        lines: [
          this.plural(d.todaySales.invoiceCount, 'invoice'),
          ...(change === null || change === undefined ? [] : [change === 0 ? 'Same as yesterday' : change > 0 ? `Up ${formatBasisPoints(change)} on yesterday` : `Down ${formatBasisPoints(-change)} on yesterday`]),
        ],
        alert: null,
      },
      {
        label: 'Outstanding',
        value: this.money(d.outstanding.balanceMinor),
        lines: [this.plural(d.outstanding.invoiceCount, 'invoice')],
        alert: d.outstanding.overdueMinor > 0 ? `Overdue ${this.money(d.outstanding.overdueMinor)}` : null,
      },
      { label: 'In stock', value: `${d.stock.units} pcs`, lines: [this.plural(d.stock.productCount, 'product')], alert: null, link: { path: '/inventory' } },
      d.monthProfit
        ? {
            label: "This month's profit",
            value: this.money(d.monthProfit.grossProfitMinor ?? 0),
            lines: [d.monthProfit.marginBp === null || d.monthProfit.marginBp === undefined ? 'No sales yet this month' : `Margin ${formatBasisPoints(d.monthProfit.marginBp)}`],
            alert: null,
          }
        : { label: "This month's profit", value: null, lines: [], alert: null },
    ];
  });

  protected readonly attention = computed(() => {
    const d = this.data();
    if (!d) return [];
    return [
      ...(d.stock.outCount > 0
        ? [{ icon: 'remove_shopping_cart', text: `${this.plural(d.stock.outCount, 'product is', 'products are')} out of stock`, danger: false, stock: 'out' as string | null }]
        : []),
      ...(d.stock.lowCount > 0 ? [{ icon: 'inventory_2', text: `${this.plural(d.stock.lowCount, 'product is', 'products are')} low in stock`, danger: false, stock: 'low' as string | null }] : []),
      ...(d.outstanding.overdueCount > 0
        ? [{ icon: 'schedule', text: `${this.plural(d.outstanding.overdueCount, 'invoice')} overdue · ${this.money(d.outstanding.overdueMinor)}`, danger: true, stock: null }]
        : []),
    ];
  });

  protected status(d: DocumentSummary) {
    return documentStatus(d);
  }

  protected docLine(d: DocumentSummary): string {
    const tz = this.session.me()?.settings.timezone ?? 'UTC';
    const owes = d.type === 'INVOICE' && d.status !== 'CANCELLED' && (d.balanceMinor ?? 0) > 0;
    const parts = [formatInstant(d.issuedAt, tz), d.salesperson.fullName];
    if (owes) parts.push(`Balance ${this.money(d.balanceMinor ?? 0)}${d.dueDate ? ` · due ${formatCalendarDate(d.dueDate)}` : ''}`);
    return parts.join(' · ');
  }

  protected customer(d: DocumentSummary): string {
    return d.customer.company ?? d.customer.name ?? '';
  }

  protected total(d: DocumentSummary): string {
    return this.money(d.totalMinor);
  }

  protected readonly inventoryValue = computed(() => {
    const v = this.data()?.inventoryValueMinor;
    return v === undefined || v === null ? null : this.money(v);
  });
}
