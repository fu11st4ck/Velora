import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { toApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { Envelope, Quotation } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatCalendarDate, formatDateTime } from '../../../core/dates/dates';
import { formatMoney } from '../../../core/money/money';
import { EntityVersions } from '../../../core/state/entity-versions';
import { Submission } from '../../../core/state/submission';
import { Confirm } from '../../../shared/ui/confirm-dialog';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { StatusPill } from '../../../shared/ui/status-pill';
import { customerLabel } from '../../customers';
import { PdfActions } from '../components/pdf-actions';
import { DocumentsApi } from '../data/documents.api';
import { quotationStatus, whatsappLink } from '../data/labels';

/** W-F3 Quotation detail. Converting opens the sale workspace with the quotation loaded. */
@Component({
  selector: 'app-quotation-detail-page',
  imports: [RouterLink, PageHeader, StateView, Skeleton, StatusPill, PdfActions, MatButton, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (failure(); as f) {
      <app-state-view [kind]="f.kind" [heading]="f.kind === 'notFound' ? 'Quotation not found' : 'Could not load this quotation'" [message]="f.kind === 'notFound' ? 'It may belong to someone else, or the link is wrong.' : f.message" [actionLabel]="f.kind === 'error' ? 'Try again' : null" (action)="resource.reload()">
        <a matButton routerLink="/documents">Back to documents</a>
      </app-state-view>
    } @else if (quotation(); as q) {
      <app-page-header overline="Quotation" [heading]="q.number">
        @if (whatsapp(); as link) {
          <a matButton="outlined" [href]="link" target="_blank" rel="noopener noreferrer"><mat-icon>chat</mat-icon>WhatsApp</a>
        }
        <app-pdf-actions kind="quotation" [id]="q.id" [number]="q.number" />
        @if (open() && canSell()) {
          <button matButton type="button" (click)="cancel(q)" [disabled]="cancelling.sending()" data-testid="quotation-cancel"><mat-icon>block</mat-icon>Cancel</button>
          <a matButton="filled" routerLink="/sell" [queryParams]="{ quotation: q.id }" data-testid="quotation-convert"><mat-icon>point_of_sale</mat-icon>Convert to sale</a>
        }
      </app-page-header>

      <section class="summary" aria-label="Summary">
        <app-status-pill [label]="status(q).label" [tone]="status(q).tone" data-testid="quotation-status" />
        <dl>
          <div><dt>Total</dt><dd class="t-money" data-testid="quotation-total">{{ money(q.totalMinor) }}</dd></div>
          <div><dt>Issued</dt><dd>{{ when(q.issuedAt) }} · {{ q.salesperson.fullName }}</dd></div>
          <div><dt>Valid until</dt><dd>{{ date(q.validUntil) }}</dd></div>
          @if (q.invoice; as inv) {
            <div><dt>Invoice</dt><dd><a [routerLink]="['/documents/invoices', inv.id]" data-testid="quotation-invoice">{{ inv.number }}</a></dd></div>
          }
        </dl>
      </section>

      <div class="columns">
        <section class="card" aria-labelledby="lines-title">
          <h2 class="t-title-md" id="lines-title">Items</h2>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th scope="col">Product</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Price</th><th scope="col" class="num">Total</th></tr></thead>
              <tbody>
                @for (l of q.lines; track l.lineNo) {
                  <tr><td><span class="strong">{{ l.name }}</span><span class="t-body-sm t-muted block">{{ l.sku }}</span></td><td class="num">{{ l.quantity }}</td><td class="num t-money">{{ money(l.unitPriceMinor) }}</td><td class="num t-money">{{ money(l.lineTotalMinor) }}</td></tr>
                }
              </tbody>
            </table>
          </div>
          <dl class="totals">
            <div><dt>Subtotal</dt><dd class="t-money">{{ money(q.subtotalMinor) }}</dd></div>
            @if (q.discountMinor > 0) { <div><dt>Discount</dt><dd class="t-money">−{{ money(q.discountMinor) }}</dd></div> }
            <div><dt>{{ q.tax.name }}</dt><dd class="t-money">{{ money(q.tax.amountMinor) }}</dd></div>
            <div class="grand"><dt>Total</dt><dd class="t-money">{{ money(q.totalMinor) }}</dd></div>
          </dl>
          @if (q.notes) { <p class="notes">{{ q.notes }}</p> }
          @if (open()) { <p class="t-body-sm t-muted">A quotation does not reserve stock; availability is checked when it is converted.</p> }
        </section>
        <section class="card" aria-labelledby="for-title">
          <h2 class="t-title-md" id="for-title">For</h2>
          <p><a [routerLink]="['/customers', q.customer.id]" class="strong">{{ customer(q) }}</a></p>
          @if (q.customer.mobile) { <p class="t-muted">{{ q.customer.mobile }}</p> }
          @if (q.customer.email) { <p class="t-muted">{{ q.customer.email }}</p> }
        </section>
      </div>
    } @else {
      <app-skeleton height="360px" />
    }
  `,
  styleUrl: './document-detail.scss',
})
export class QuotationDetailPage {
  readonly id = input.required<string>();
  private readonly session = inject(SessionStore);
  private readonly versions = inject(EntityVersions);
  private readonly api = inject(DocumentsApi);
  private readonly confirm = inject(Confirm);
  private readonly notify = inject(Notify);
  protected readonly cancelling = new Submission();

  protected readonly resource = httpResource<Envelope<Quotation>>(() => {
    this.versions.of('documents')();
    return `${environment.apiBaseUrl}/quotations/${encodeURIComponent(this.id())}`;
  });
  protected readonly quotation = computed(() => (this.resource.hasValue() ? this.resource.value().data : null));
  protected readonly failure = computed(() => {
    const error = this.resource.error();
    if (!error) return null;
    const f = toApiFailure(error instanceof HttpErrorResponse ? error : (error.cause ?? error));
    return { kind: f.kind === 'notFound' ? ('notFound' as const) : ('error' as const), message: describeFailure(f) };
  });
  protected readonly open = computed(() => this.quotation()?.status === 'OPEN');
  protected readonly canSell = computed(() => this.session.can('sale.create'));
  protected readonly whatsapp = computed(() => {
    const q = this.quotation();
    if (!q) return null;
    const org = this.session.me()?.membership.organization.name ?? '';
    return whatsappLink(q.customer.mobile, `${org} — quotation ${q.number}, total ${this.money(q.totalMinor)}${q.validUntil ? `, valid until ${formatCalendarDate(q.validUntil)}` : ''}.`);
  });

  protected status(q: Quotation) {
    return quotationStatus(q);
  }
  protected customer(q: Quotation): string {
    return customerLabel(q.customer);
  }
  protected money(minor: number): string {
    return formatMoney(minor, this.session.money());
  }
  protected date(d: string | null | undefined): string {
    return d ? formatCalendarDate(d) : '—';
  }
  protected when(iso: string): string {
    return formatDateTime(iso, this.session.me()?.settings.timezone ?? 'UTC');
  }

  protected async cancel(q: Quotation): Promise<void> {
    const yes = await this.confirm.ask({ title: `Cancel ${q.number}?`, message: 'The quotation can no longer be converted into a sale. It stays in the records.', confirmLabel: 'Cancel quotation', cancelLabel: 'Keep it', danger: true });
    if (!yes) return;
    await this.cancelling.run(() => this.api.cancelQuotation(q.id, null));
    const f = this.cancelling.failure();
    if (f) this.notify.error(describeFailure(f));
    else this.notify.success(`${q.number} cancelled.`);
  }
}
