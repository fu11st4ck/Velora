import { ScrollRegion } from '../../../shared/table/scroll-region';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatLabel, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { describeFailure } from '../../../core/api/messages';
import type { DocumentSummary, Member } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatCalendarDate, formatInstant } from '../../../core/dates/dates';
import { formatMoney } from '../../../core/money/money';
import { EntityVersions } from '../../../core/state/entity-versions';
import { documentStatus } from '../../../shared/domain/document-status';
import { LoadMore } from '../../../shared/table/load-more';
import { COMPACT, mediaQuery } from '../../../shared/table/media';
import { PagedList } from '../../../shared/table/paged-list';
import { UrlSearch } from '../../../shared/table/url-search';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { StatusPill } from '../../../shared/ui/status-pill';
import { DocumentsApi, type DocumentQuery, type DocumentStatusFilter, type DocumentType } from '../data/documents.api';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INVOICE_CHIPS: { value: DocumentStatusFilter; label: string }[] = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partly paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];
const QUOTATION_CHIPS: { value: DocumentStatusFilter; label: string }[] = [
  { value: 'quotation_open', label: 'Open' },
  { value: 'quotation_converted', label: 'Converted' },
  { value: 'quotation_expired', label: 'Expired' },
  { value: 'quotation_cancelled', label: 'Cancelled' },
];

/** W-F1 Documents. Newest first (the only order the API offers). A salesperson sees their own documents. */
@Component({
  selector: 'app-documents-page',
  imports: [ScrollRegion, FormsModule, RouterLink, PageHeader, StateView, Skeleton, StatusPill, LoadMore, MatButton, MatIconButton, MatIcon, MatFormField, MatLabel, MatPrefix, MatSuffix, MatInput, MatSelect, MatOption],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './documents.page.html',
  styleUrl: './documents.page.scss',
})
export class DocumentsPage {
  private readonly api = inject(DocumentsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  private readonly versions = inject(EntityVersions);
  protected readonly compact = mediaQuery(COMPACT);
  protected readonly list = new PagedList<DocumentSummary>();
  protected readonly seesAll = computed(() => this.session.can('document.read_all'));
  protected readonly members = signal<Member[]>([]);

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly query = computed<DocumentQuery>(() => {
    const p = this.params();
    const type = p.get('type');
    const chips = type === 'quotation' ? QUOTATION_CHIPS : INVOICE_CHIPS;
    const from = p.get('from');
    const to = p.get('to');
    return {
      type: type === 'invoice' || type === 'quotation' ? type : undefined,
      status: (p.get('status') ?? '').split(',').filter((s): s is DocumentStatusFilter => chips.some((c) => c.value === s)),
      q: p.get('q')?.trim() || undefined,
      salespersonId: this.seesAll() ? (p.get('salesperson') ?? undefined) : undefined,
      from: from && DATE.test(from) ? from : undefined,
      to: to && DATE.test(to) ? to : undefined,
      limit: 25,
    };
  });
  protected readonly chips = computed(() => {
    const q = this.query();
    return (q.type === 'quotation' ? QUOTATION_CHIPS : INVOICE_CHIPS).map((c) => ({ ...c, selected: q.status?.includes(c.value) ?? false }));
  });
  protected readonly filtered = computed(() => {
    const q = this.query();
    return !!(q.type || q.status?.length || q.q || q.salespersonId || q.from || q.to);
  });
  protected readonly rangeInvalid = computed(() => {
    const q = this.query();
    return !!q.from && !!q.to && q.from > q.to;
  });
  protected readonly search = new UrlSearch(this.params, (q) => this.navigate({ q }, true));
  protected readonly failure = computed(() => {
    const f = this.list.failure();
    return f ? describeFailure(f) : null;
  });

  constructor() {
    let lastKey = '';
    effect(() => {
      const query = this.query();
      this.versions.of('documents')();
      this.versions.of('payments')();
      const key = JSON.stringify(query);
      untracked(() => {
        if (this.rangeInvalid()) return;
        void this.list.load((cursor) => this.api.list(query, cursor), { keepItems: key === lastKey });
        lastKey = key;
      });
    });
    if (this.seesAll() && this.session.can('team.read')) {
      this.api.members().then(
        (m) => this.members.set(m),
        () => this.members.set([]),
      );
    }
  }

  protected navigate(changes: Record<string, string | null>, replaceUrl = false): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: changes, queryParamsHandling: 'merge', replaceUrl });
  }

  protected setType(type: DocumentType | null): void {
    this.navigate({ type, status: null });
  }

  protected toggleStatus(value: DocumentStatusFilter): void {
    const current = new Set(this.query().status);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    // Invoice statuses apply to invoices: choosing one under "All" narrows the list to invoices.
    this.navigate({ status: current.size ? [...current].join(',') : null, ...(this.query().type ? {} : { type: 'invoice' }) });
  }

  protected setDate(which: 'from' | 'to', value: string): void {
    this.navigate({ [which]: DATE.test(value) ? value : null });
  }

  protected clearFilters(): void {
    this.search.reset();
    this.navigate({ type: null, status: null, q: null, salesperson: null, from: null, to: null });
  }

  protected link(d: DocumentSummary): string[] {
    return d.type === 'INVOICE' ? ['/documents/invoices', d.id] : ['/documents/quotations', d.id];
  }
  protected status(d: DocumentSummary) {
    return documentStatus(d);
  }
  protected money(minor: number | null | undefined): string {
    return minor === null || minor === undefined ? '—' : formatMoney(minor, this.session.money());
  }
  protected issued(d: DocumentSummary): string {
    return formatInstant(d.issuedAt, this.session.me()?.settings.timezone ?? 'UTC');
  }
  protected due(d: DocumentSummary): string | null {
    return d.type === 'INVOICE' && d.status !== 'CANCELLED' && (d.balanceMinor ?? 0) > 0 && d.dueDate ? formatCalendarDate(d.dueDate) : null;
  }
  protected owes(d: DocumentSummary): boolean {
    return d.type === 'INVOICE' && d.status !== 'CANCELLED';
  }
}
