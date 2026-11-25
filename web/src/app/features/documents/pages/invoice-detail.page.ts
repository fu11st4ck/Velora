import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { toApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { Envelope, Invoice, Payment } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatCalendarDate, formatDateTime } from '../../../core/dates/dates';
import { formatBasisPoints, formatMoney } from '../../../core/money/money';
import { EntityVersions } from '../../../core/state/entity-versions';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { StatusPill } from '../../../shared/ui/status-pill';
import { customerLabel } from '../../customers';
import { InvoiceDialogs } from '../components/invoice-dialogs';
import { PdfActions } from '../components/pdf-actions';
import { invoiceStatus, methodLabel, whatsappLink } from '../data/labels';

/** W-F2 Invoice detail. Every figure is the server's; actions appear only for roles that may use them. */
@Component({
  selector: 'app-invoice-detail-page',
  imports: [RouterLink, PageHeader, StateView, Skeleton, StatusPill, PdfActions, MatButton, MatIcon, MatMenu, MatMenuItem, MatMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-detail.page.html',
  styleUrl: './document-detail.scss',
})
export class InvoiceDetailPage {
  readonly id = input.required<string>();
  private readonly session = inject(SessionStore);
  private readonly versions = inject(EntityVersions);
  private readonly dialogs = inject(InvoiceDialogs);
  private readonly notify = inject(Notify);

  protected readonly resource = httpResource<Envelope<Invoice>>(() => {
    this.versions.of('documents')();
    this.versions.of('payments')();
    return `${environment.apiBaseUrl}/invoices/${encodeURIComponent(this.id())}`;
  });
  protected readonly invoice = computed(() => (this.resource.hasValue() ? this.resource.value().data : null));
  protected readonly failure = computed(() => {
    const error = this.resource.error();
    if (!error) return null;
    const f = toApiFailure(error instanceof HttpErrorResponse ? error : (error.cause ?? error));
    return { kind: f.kind === 'notFound' ? ('notFound' as const) : ('error' as const), message: describeFailure(f) };
  });

  private readonly issued = computed(() => this.invoice()?.status === 'ISSUED');
  protected readonly canPay = computed(() => this.issued() && (this.invoice()?.balanceMinor ?? 0) > 0 && this.session.can('payment.record'));
  protected readonly canRefund = computed(() => this.issued() && (this.invoice()?.paidMinor ?? 0) > 0 && this.session.can('payment.refund'));
  protected readonly canCancel = computed(() => this.issued() && (this.invoice()?.returns.length ?? 0) === 0 && this.session.can('invoice.cancel'));
  protected readonly canReturn = computed(() => this.issued() && this.session.can('invoice.return') && (this.invoice()?.lines.some((l) => l.quantity > (l.returnedQuantity ?? 0)) ?? false));
  protected readonly seesCost = computed(() => this.session.can('product.read_cost'));
  protected readonly status = computed(() => {
    const i = this.invoice();
    return i ? invoiceStatus(i) : null;
  });
  protected readonly customerName = computed(() => {
    const i = this.invoice();
    return i ? customerLabel(i.customer) : '';
  });
  protected readonly payments = computed(() => [...(this.invoice()?.payments ?? [])].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)));
  protected readonly whatsapp = computed(() => {
    const i = this.invoice();
    if (!i) return null;
    const balance = i.balanceMinor > 0 && i.status === 'ISSUED' ? ` Balance due: ${this.money(i.balanceMinor)}${i.dueDate ? ` by ${formatCalendarDate(i.dueDate)}` : ''}.` : '';
    const org = this.session.me()?.membership.organization.name ?? '';
    return whatsappLink(i.customer.mobile, `${org} — invoice ${i.number}, total ${this.money(i.totalMinor)}.${balance}`);
  });

  protected money(minor: number | null | undefined): string {
    return minor === null || minor === undefined ? '—' : formatMoney(minor, this.session.money());
  }
  protected bp(v: number | null | undefined): string {
    return v === null || v === undefined ? '—' : formatBasisPoints(v);
  }
  protected when(iso: string | undefined): string {
    return iso ? formatDateTime(iso, this.session.me()?.settings.timezone ?? 'UTC') : '—';
  }
  protected date(d: string | null | undefined): string {
    return d ? formatCalendarDate(d) : '—';
  }
  protected method(p: Payment): string {
    return methodLabel(p.method);
  }

  protected async recordPayment(i: Invoice): Promise<void> {
    const updated = await this.dialogs.recordPayment(i);
    if (updated) this.notify.success(updated.balanceMinor === 0 ? `${updated.number} is paid in full.` : `Payment recorded. ${this.money(updated.balanceMinor)} remains.`);
  }
  protected async refund(i: Invoice): Promise<void> {
    if (await this.dialogs.refund(i)) this.notify.success('Refund recorded.');
  }
  protected async cancel(i: Invoice): Promise<void> {
    if (await this.dialogs.cancel(i)) this.notify.success(`${i.number} cancelled. Stock restored.`);
  }
}
