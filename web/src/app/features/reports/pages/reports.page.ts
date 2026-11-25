import { ChangeDetectionStrategy, Component, DOCUMENT, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { ActivatedRoute, Router } from '@angular/router';
import { toApiFailure, type ApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import { SessionStore } from '../../../core/auth/session.store';
import { formatCalendarDate } from '../../../core/dates/dates';
import { formatBasisPoints, formatMoney } from '../../../core/money/money';
import { EntityVersions } from '../../../core/state/entity-versions';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { BarList, type BarRow } from '../components/bar-list';
import { StatusBar, type Part } from '../components/status-bar';
import { PRESETS, periodProblem, presetPeriod, type Preset } from '../data/periods';
import { ReportsApi, type Period, type SalesPerson, type SalesSummary, type StatusRow, type Valuation } from '../data/reports.api';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Section<T> {
  data: T | null;
  failure: ApiFailure | null;
}

/**
 * W-G1 Reports. The period is a range of business days in the organization's time zone, kept in
 * the URL. A salesperson sees their own figures and none of the cost-based sections.
 */
@Component({
  selector: 'app-reports-page',
  imports: [PageHeader, StateView, Skeleton, StatusBar, BarList, MatButton, MatIcon, MatMenu, MatMenuItem, MatMenuTrigger, MatFormField, MatLabel, MatInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports.page.html',
  styleUrl: './reports.page.scss',
})
export class ReportsPage {
  private readonly api = inject(ReportsApi);
  private readonly session = inject(SessionStore);
  private readonly versions = inject(EntityVersions);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notify = inject(Notify);
  private readonly document = inject(DOCUMENT);

  protected readonly presets = PRESETS;
  protected readonly all = computed(() => this.session.can('report.read_all'));
  private readonly tz = computed(() => this.session.me()?.settings.timezone ?? 'UTC');
  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly preset = computed<Preset>(() => {
    const p = this.params().get('range');
    return PRESETS.some((x) => x.value === p) ? (p as Preset) : 'month';
  });
  protected readonly period = computed<Period | null>(() => {
    const preset = this.preset();
    if (preset !== 'custom') return presetPeriod(preset, this.tz());
    const from = this.params().get('from');
    const to = this.params().get('to');
    return from && to && DATE.test(from) && DATE.test(to) ? { from, to } : null;
  });
  protected readonly problem = computed(() => {
    const p = this.period();
    return p ? periodProblem(p) : this.preset() === 'custom' ? 'Choose a start and an end date.' : null;
  });
  protected readonly periodLabel = computed(() => {
    const p = this.period();
    if (!p) return '';
    return p.from === p.to ? formatCalendarDate(p.from) : `${formatCalendarDate(p.from)} – ${formatCalendarDate(p.to)}`;
  });

  protected readonly summary = signal<Section<SalesSummary>>({ data: null, failure: null });
  protected readonly statuses = signal<Section<StatusRow[]>>({ data: null, failure: null });
  protected readonly people = signal<Section<SalesPerson[]>>({ data: null, failure: null });
  protected readonly stock = signal<Section<Valuation>>({ data: null, failure: null });
  protected readonly exporting = signal(false);
  private generation = 0;

  constructor() {
    effect(() => {
      const period = this.period();
      const problem = this.problem();
      this.versions.of('documents')();
      this.versions.of('payments')();
      this.versions.of('stock')();
      untracked(() => {
        if (period && !problem) void this.load(period);
      });
    });
  }

  private async section<T>(target: ReturnType<typeof signal<Section<T>>>, generation: number, fetch: () => Promise<T>): Promise<void> {
    try {
      const data = await fetch();
      if (generation === this.generation) target.set({ data, failure: null });
    } catch (e) {
      if (generation === this.generation) target.set({ data: null, failure: toApiFailure(e) });
    }
  }

  private async load(period: Period): Promise<void> {
    const generation = ++this.generation;
    const jobs = [this.section(this.summary, generation, () => this.api.salesSummary(period)), this.section(this.statuses, generation, () => this.api.paymentStatus(period))];
    if (this.all()) {
      jobs.push(this.section(this.people, generation, () => this.api.salesBySalesperson(period)), this.section(this.stock, generation, () => this.api.valuation(5)));
    }
    await Promise.all(jobs);
  }

  protected reload(): void {
    const p = this.period();
    if (p && !this.problem()) void this.load(p);
  }

  protected setPreset(preset: Preset): void {
    if (preset === 'custom') {
      const p = this.period() ?? presetPeriod('month', this.tz());
      void this.router.navigate([], { relativeTo: this.route, queryParams: { range: 'custom', from: p.from, to: p.to } });
    } else {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { range: preset === 'month' ? null : preset, from: null, to: null } });
    }
  }

  protected setDate(which: 'from' | 'to', value: string): void {
    if (!DATE.test(value)) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { range: 'custom', [which]: value }, queryParamsHandling: 'merge' });
  }

  protected money(minor: number | null | undefined): string {
    return minor === null || minor === undefined ? '—' : formatMoney(minor, this.session.money());
  }
  protected bp(v: number | null | undefined): string {
    return v === null || v === undefined ? '—' : formatBasisPoints(v);
  }
  protected message(f: ApiFailure): string {
    return describeFailure(f);
  }

  /** The three exclusive parts of the period's invoices, by value. Overdue (a subset) is reported apart. */
  protected readonly statusParts = computed<Part[]>(() => {
    const rows = this.statuses().data ?? [];
    const row = (s: StatusRow['status']) => rows.find((r) => r.status === s);
    const part = (s: 'PAID' | 'PARTIAL' | 'UNPAID', label: string, color: string, ink: string): Part => {
      const r = row(s);
      return { key: s.toLowerCase(), label, color, ink, value: r?.totalMinor ?? 0, detail: `${r?.count ?? 0} ${r?.count === 1 ? 'invoice' : 'invoices'} · ${this.money(r?.totalMinor ?? 0)}` };
    };
    return [
      // Near-black ink on every fill: white on this green is only 3:1 (WCAG AA needs 4.5:1 for small text).
      part('PAID', 'Paid', 'var(--chart-good)', 'var(--chart-ink-dark)'),
      part('PARTIAL', 'Partly paid', 'var(--chart-warning)', 'var(--chart-ink-dark)'),
      part('UNPAID', 'Unpaid', 'var(--chart-neutral)', 'var(--chart-ink-dark)'),
    ];
  });
  protected readonly statusTable = computed(() => {
    const rows = this.statuses().data ?? [];
    const total = rows.filter((r) => r.status !== 'OVERDUE').reduce((s, r) => s + r.totalMinor, 0);
    return this.statusParts().map((p) => {
      const r = rows.find((x) => x.status.toLowerCase() === p.key);
      return { ...p, count: r?.count ?? 0, amount: this.money(r?.totalMinor ?? 0), balance: this.money(r?.balanceMinor ?? 0), share: total > 0 ? `${Math.round(((r?.totalMinor ?? 0) / total) * 100)}%` : '—' };
    });
  });
  protected readonly overdue = computed(() => this.statuses().data?.find((r) => r.status === 'OVERDUE') ?? null);
  protected readonly hasInvoices = computed(() => (this.statuses().data ?? []).some((r) => r.status !== 'OVERDUE' && r.count > 0));

  protected readonly peopleRows = computed<BarRow[]>(() =>
    [...(this.people().data ?? [])]
      .sort((a, b) => b.netSalesMinor - a.netSalesMinor)
      .map((p) => ({
        key: p.memberId,
        label: p.fullName,
        value: Math.max(0, p.netSalesMinor),
        valueText: this.money(p.netSalesMinor),
        detail: `${p.invoiceCount} ${p.invoiceCount === 1 ? 'invoice' : 'invoices'}${p.grossProfitMinor === undefined ? '' : ` · profit ${this.money(p.grossProfitMinor)}`}`,
      })),
  );
  protected readonly stockRows = computed<BarRow[]>(() =>
    (this.stock().data?.rows ?? []).map((r) => ({ key: r.productId, label: r.name, value: r.valueMinor, valueText: this.money(r.valueMinor), detail: `${r.quantity} on hand · ${r.sku}` })),
  );

  protected async export(kind: 'sales' | 'stock'): Promise<void> {
    const p = this.period();
    if (kind === 'sales' && (!p || this.problem())) return;
    this.exporting.set(true);
    try {
      const { blob, filename } = await this.api.csv(kind, p ?? undefined);
      const url = URL.createObjectURL(blob);
      const a = this.document.createElement('a');
      a.href = url;
      a.download = filename;
      this.document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      this.notify.error(describeFailure(toApiFailure(e)));
    } finally {
      this.exporting.set(false);
    }
  }
}
