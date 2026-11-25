import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { toApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { CustomerDetail, DocumentSummary, Envelope } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatMoney } from '../../../core/money/money';
import { EntityVersions } from '../../../core/state/entity-versions';
import { Submission } from '../../../core/state/submission';
import { DocumentRows } from '../../../shared/domain/document-rows';
import { LoadMore } from '../../../shared/table/load-more';
import { PagedList } from '../../../shared/table/paged-list';
import { Confirm } from '../../../shared/ui/confirm-dialog';
import { KpiTile } from '../../../shared/ui/kpi-tile';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { CustomersApi, customerLabel } from '../data/customers.api';

/** W-E2 Customer detail. A salesperson's figures and documents are their own (the server filters them). */
@Component({
  selector: 'app-customer-detail-page',
  imports: [RouterLink, PageHeader, StateView, Skeleton, KpiTile, DocumentRows, LoadMore, MatButton, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-detail.page.html',
  styleUrl: './customer-detail.page.scss',
})
export class CustomerDetailPage {
  readonly id = input.required<string>();
  private readonly session = inject(SessionStore);
  private readonly versions = inject(EntityVersions);
  private readonly api = inject(CustomersApi);
  private readonly confirm = inject(Confirm);
  private readonly notify = inject(Notify);
  private readonly router = inject(Router);
  protected readonly archiving = new Submission();
  protected readonly documents = new PagedList<DocumentSummary>();

  protected readonly resource = httpResource<Envelope<CustomerDetail>>(() => {
    this.versions.of('customers')();
    this.versions.of('documents')();
    return `${environment.apiBaseUrl}/customers/${encodeURIComponent(this.id())}`;
  });
  protected readonly customer = computed(() => (this.resource.hasValue() ? this.resource.value().data : null));
  protected readonly failure = computed(() => {
    const error = this.resource.error();
    if (!error) return null;
    const f = toApiFailure(error instanceof HttpErrorResponse ? error : (error.cause ?? error));
    return { kind: f.kind === 'notFound' ? ('notFound' as const) : ('error' as const), message: describeFailure(f) };
  });
  protected readonly title = computed(() => {
    const c = this.customer();
    return c ? customerLabel(c) : '';
  });
  protected readonly canWrite = computed(() => this.session.can('customer.write') && !this.customer()?.archivedAt);
  protected readonly canArchive = computed(() => this.session.can('customer.archive') && !this.customer()?.archivedAt);
  protected readonly canSell = computed(() => this.session.can('sale.create') && !this.customer()?.archivedAt);
  protected readonly own = computed(() => !this.session.can('document.read_all'));

  protected readonly contact = computed(() => {
    const c = this.customer();
    if (!c) return null;
    const digits = c.mobile?.replace(/\D/g, '') ?? '';
    return {
      tel: c.mobile ? `tel:${c.mobile}` : null,
      whatsapp: digits ? `https://wa.me/${digits}` : null,
      email: c.email ? `mailto:${c.email}` : null,
    };
  });

  constructor() {
    effect(() => {
      const id = this.id();
      this.versions.of('documents')();
      untracked(() => void this.documents.load((cursor) => this.api.documents(id, cursor)));
    });
  }

  protected money(minor: number | undefined): string {
    return formatMoney(minor ?? 0, this.session.money());
  }

  protected async archive(): Promise<void> {
    const c = this.customer();
    if (!c) return;
    const yes = await this.confirm.ask({
      title: 'Archive this customer?',
      message: `${customerLabel(c)} will no longer appear in customer lists or be available for new sales. Their documents are kept.`,
      confirmLabel: 'Archive',
      danger: true,
    });
    if (!yes) return;
    await this.archiving.run(() => this.api.archive(c.id));
    const f = this.archiving.failure();
    if (f) {
      this.notify.error(describeFailure(f));
      return;
    }
    this.notify.success(`${customerLabel(c)} archived.`);
    void this.router.navigate(['/customers']);
  }

  protected readonly documentsFailure = computed(() => {
    const f = this.documents.failure();
    return f ? describeFailure(f) : null;
  });
}
