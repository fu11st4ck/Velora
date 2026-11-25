import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import { toApiFailure, type ApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { Invoice } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatMoney } from '../../../core/money/money';
import { Submission } from '../../../core/state/submission';
import { Confirm } from '../../../shared/ui/confirm-dialog';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { DocumentsApi, type PaymentMethod, type ReturnBody } from '../data/documents.api';
import { InvoicesReader } from '../data/invoices-reader';

interface ReturnLine {
  lineNo: number;
  name: string;
  sku: string;
  returnable: number;
  quantity: number;
  restock: boolean;
}

/**
 * W-F7 Return items. The credit and any refund are calculated by the server (rules C3, C4): the
 * credit first reduces what is still owed and only the excess is refunded. When the server says a
 * refund is due, the page asks how it is paid back and sends the return again (two steps, as on mobile).
 */
@Component({
  selector: 'app-return-page',
  imports: [FormsModule, RouterLink, PageHeader, StateView, Skeleton, MatButton, MatIconButton, MatIcon, MatFormField, MatLabel, MatInput, MatSlideToggle, MatButtonToggleGroup, MatButtonToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './return.page.html',
  styleUrl: './document-detail.scss',
})
export class ReturnPage {
  readonly id = input.required<string>();
  private readonly api = inject(DocumentsApi);
  private readonly reader = inject(InvoicesReader);
  private readonly session = inject(SessionStore);
  private readonly confirm = inject(Confirm);
  private readonly notify = inject(Notify);
  private readonly router = inject(Router);

  protected readonly invoice = signal<Invoice | null>(null);
  protected readonly loadFailure = signal<ApiFailure | null>(null);
  protected readonly lines = signal<ReturnLine[]>([]);
  protected reason = '';
  protected readonly submission = new Submission();
  /** Set when the server answered that this amount must be refunded. */
  protected readonly refundDue = signal<number | null>(null);
  protected readonly refundMethod = signal<PaymentMethod | null>(null);
  protected refundReference = '';
  protected readonly touched = signal(false);

  protected readonly selected = computed(() => this.lines().filter((l) => l.quantity > 0));
  protected readonly itemCount = computed(() => this.selected().reduce((n, l) => n + l.quantity, 0));
  protected readonly reasonValid = signal(false);
  protected readonly error = computed(() => {
    const f = this.submission.failure();
    if (!f || (f.kind === 'business' && f.code === 'REFUND_METHOD_REQUIRED')) return null;
    return this.submission.unconfirmed() ? 'The connection dropped before Velora confirmed this. Try again — it will not be recorded twice.' : describeFailure(f);
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  protected async load(id = this.id()): Promise<void> {
    this.loadFailure.set(null);
    try {
      const invoice = await this.reader.invoice(id);
      this.invoice.set(invoice);
      this.lines.set(
        invoice.lines
          .map((l) => ({ lineNo: l.lineNo, name: l.name, sku: l.sku, returnable: l.quantity - (l.returnedQuantity ?? 0), quantity: 0, restock: true }))
          .filter((l) => l.returnable > 0),
      );
    } catch (e) {
      this.loadFailure.set(toApiFailure(e));
    }
  }

  private changed(): void {
    this.submission.inputChanged();
    this.refundDue.set(null);
    this.refundMethod.set(null);
  }

  protected setQuantity(line: ReturnLine, quantity: number): void {
    const q = Math.min(Math.max(0, Math.trunc(quantity) || 0), line.returnable);
    this.lines.update((ls) => ls.map((l) => (l.lineNo === line.lineNo ? { ...l, quantity: q } : l)));
    this.changed();
  }

  protected setRestock(line: ReturnLine, restock: boolean): void {
    this.lines.update((ls) => ls.map((l) => (l.lineNo === line.lineNo ? { ...l, restock } : l)));
    this.changed();
  }

  protected onReason(text: string): void {
    this.reason = text;
    this.reasonValid.set(text.trim().length >= 3);
    this.changed();
  }

  protected money(minor: number): string {
    return formatMoney(minor, this.session.money());
  }

  protected async submit(): Promise<void> {
    this.touched.set(true);
    const invoice = this.invoice();
    if (!invoice || this.selected().length === 0 || !this.reasonValid() || this.submission.sending()) return;
    const due = this.refundDue();
    if (due !== null && !this.refundMethod()) return;
    if (due === null && !this.submission.unconfirmed()) {
      const restocked = this.selected().filter((l) => l.restock).reduce((n, l) => n + l.quantity, 0);
      const yes = await this.confirm.ask({
        title: `Return ${this.itemCount()} ${this.itemCount() === 1 ? 'item' : 'items'}?`,
        message: `A credit note will be issued against ${invoice.number}. ${restocked} ${restocked === 1 ? 'item goes' : 'items go'} back to stock. The credit reduces the balance first; anything above it is refunded.`,
        confirmLabel: 'Issue credit note',
      });
      if (!yes) return;
    }
    const body: ReturnBody = {
      reason: this.reason.trim(),
      lines: this.selected().map((l) => ({ lineNo: l.lineNo, quantity: l.quantity, restock: l.restock })),
      ...(due !== null && this.refundMethod() ? { refund: { method: this.refundMethod()!, reference: this.refundMethod() === 'BANK_TRANSFER' ? this.refundReference.trim() || null : null } } : {}),
    };
    const result = await this.submission.run((k) => this.api.createReturn(invoice.id, body, k));
    if (result) {
      const r = result.return;
      this.notify.success(`Credit note ${r.number} issued for ${this.money(r.totalMinor)}${r.refundMinor > 0 ? `; ${this.money(r.refundMinor)} refunded` : ''}.`);
      void this.router.navigate(['/documents/invoices', invoice.id]);
      return;
    }
    const f = this.submission.failure();
    if (f?.kind === 'business' && f.code === 'REFUND_METHOD_REQUIRED') {
      const amount = f.details[0]?.['refundMinor'];
      this.refundDue.set(typeof amount === 'number' ? amount : 0);
    }
  }
}
