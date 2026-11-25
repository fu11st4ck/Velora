import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { describeFailure } from '../../../core/api/messages';
import type { Invoice } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { addDays, formatCalendarDate, today } from '../../../core/dates/dates';
import { formatMoney, parseMoney } from '../../../core/money/money';
import { Confirm } from '../../../shared/ui/confirm-dialog';
import { customerLabel } from '../../customers';
import { SalesApi, type InvoiceBody, type PaymentMethod } from '../data/sales.api';
import { SaleStore } from '../state/sale.store';

type AmountChoice = 'full' | 'half' | 'none' | 'other';

/**
 * W-D4 Review and payment. The amounts shown are the server's preview; the server prices the sale
 * again when it is confirmed and refuses it if anything changed (stock, prices).
 */
@Component({
  selector: 'app-payment-panel',
  imports: [FormsModule, MatButton, MatButtonToggleGroup, MatButtonToggle, MatFormField, MatLabel, MatHint, MatSuffix, MatInput, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payment-panel.html',
  styleUrl: './payment-panel.scss',
})
export class PaymentPanel {
  readonly back = output<void>();
  readonly completed = output<Invoice>();
  protected readonly sale = inject(SaleStore);
  private readonly api = inject(SalesApi);
  private readonly session = inject(SessionStore);
  private readonly confirm = inject(Confirm);

  protected readonly total = computed(() => this.sale.preview()?.totalMinor ?? 0);
  protected readonly choice = signal<AmountChoice>('full');
  protected readonly otherText = signal('');
  protected readonly method = signal<PaymentMethod>('CASH');
  protected readonly reference = signal('');
  protected readonly creditDays = signal(String(this.session.me()?.settings.defaultCreditDays ?? 30));
  protected readonly currency = computed(() => this.session.money().currencyCode);

  /** Money received now, in minor units; null when the typed amount is not valid. */
  protected readonly received = computed<number | null>(() => {
    const total = this.total();
    switch (this.choice()) {
      case 'full':
        return total;
      case 'half':
        return Number(BigInt(total) / 2n);
      case 'none':
        return 0;
      default:
        return parseMoney(this.otherText(), { exponent: this.session.money().exponent });
    }
  });
  protected readonly amountError = computed(() => {
    const r = this.received();
    if (r === null) return 'Enter an amount, for example 1,000.00.';
    if (r > this.total()) return `At most the total, ${this.money(this.total())}.`;
    return null;
  });
  protected readonly balance = computed(() => this.total() - (this.received() ?? 0));
  protected readonly days = computed(() => {
    const n = Number(this.creditDays());
    return Number.isInteger(n) && n >= 0 && n <= 365 ? n : null;
  });
  protected readonly dueDate = computed(() => {
    const days = this.days();
    const tz = this.session.me()?.settings.timezone ?? 'UTC';
    return days === null ? null : addDays(today(tz), days);
  });
  protected readonly outcome = computed(() => {
    if (this.amountError()) return null;
    const balance = this.balance();
    if (balance === 0) return 'Paid in full.';
    const due = this.dueDate();
    const when = due ? ` due ${formatCalendarDate(due)}` : '';
    return (this.received() ?? 0) > 0 ? `Partially paid — ${this.money(balance)}${when}.` : `Unpaid — ${this.money(balance)}${when}.`;
  });
  protected readonly dueLabel = computed(() => {
    const due = this.dueDate();
    return due ? `Due ${formatCalendarDate(due)}` : '0 to 365 days';
  });
  /** After a lost answer the sale may exist: only an identical retry is offered until it is confirmed. */
  protected readonly locked = computed(() => this.sale.submission.sending() || this.sale.submission.unconfirmed());
  protected readonly referenceError = computed(() => (this.reference().length > 80 ? 'At most 80 characters.' : null));
  protected readonly invalid = computed(() => !!this.amountError() || !!this.referenceError() || (this.balance() > 0 && this.days() === null));
  protected readonly customerName = computed(() => {
    const c = this.sale.customer();
    return c ? customerLabel(c) : '';
  });
  protected readonly failure = computed(() => {
    const f = this.sale.submission.failure();
    if (!f) return null;
    if (this.sale.submission.unconfirmed()) return 'We could not confirm the sale — the connection dropped. Retry: it will not be recorded twice.';
    return describeFailure(f);
  });

  protected money(minor: number): string {
    return formatMoney(minor, this.session.money());
  }

  protected choose(choice: AmountChoice): void {
    this.choice.set(choice);
    this.sale.submission.inputChanged();
  }

  protected changed(): void {
    this.sale.submission.inputChanged();
  }

  protected async confirmSale(): Promise<void> {
    const body = this.sale.body();
    const customer = this.sale.customer();
    if (!body || !customer || this.invalid() || this.sale.submission.sending()) return;
    const received = this.received() ?? 0;
    const items = this.sale.itemCount();
    // A retry after a lost answer re-sends the same sale with the same key, without asking again.
    if (!this.sale.submission.unconfirmed()) {
      const yes = await this.confirm.ask({
        title: 'Confirm the sale?',
        message: [
          `${this.customerName()} · total ${this.money(this.total())}`,
          received > 0 ? `Received now: ${this.money(received)} (${this.method() === 'CASH' ? 'cash' : 'bank transfer'})` : 'Nothing received now.',
          this.outcome() ?? '',
          `${items} ${items === 1 ? 'item leaves' : 'items leave'} stock.`,
        ].join('\n'),
        confirmLabel: 'Issue invoice',
      });
      if (!yes) return;
    }
    const invoice: InvoiceBody = {
      ...body,
      customerId: customer.id,
      quotationId: this.sale.quotation()?.id ?? null,
      notes: this.sale.notes().trim() || null,
      payment: received > 0 ? { amountMinor: received, method: this.method(), reference: this.method() === 'BANK_TRANSFER' ? this.reference().trim() || null : null } : null,
      ...(this.balance() > 0 ? { creditDays: this.days() } : {}),
    };
    const result = await this.sale.submission.run((key) => this.api.createInvoice(invoice, key));
    if (result) {
      this.completed.emit(result);
      return;
    }
    // A definite refusal (stock taken by another sale, prices changed…): back to the cart, where the
    // preview shows the problems on their lines. Nothing was saved.
    if (!this.sale.submission.unconfirmed()) this.back.emit();
  }
}
