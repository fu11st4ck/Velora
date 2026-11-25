import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatHint, MatLabel, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { Invoice, PricingPreview, Product, Quotation, TaxRate } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatBasisPoints, formatMoney, parseMoney } from '../../../core/money/money';
import { Submission } from '../../../core/state/submission';
import { COMPACT, mediaQuery } from '../../../shared/table/media';
import { Confirm } from '../../../shared/ui/confirm-dialog';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { CustomerPicker, CustomersApi, customerLabel } from '../../customers';
import { PaymentPanel } from '../components/payment-panel';
import { PriceEditor } from '../components/price-editor';
import { SalesApi } from '../data/sales.api';
import { SaleStore, type CartLine } from '../state/sale.store';

type Issue = PricingPreview['lines'][number]['issues'][number];

/**
 * W-D1 Sale workspace. Prices and totals shown in the cart are the server's preview; the sale is
 * priced again by the server when it is confirmed.
 */
@Component({
  selector: 'app-sell-page',
  imports: [
    FormsModule, RouterLink, PageHeader, Skeleton, PaymentPanel,
    MatButton, MatIconButton, MatIcon, MatFormField, MatLabel, MatHint, MatPrefix, MatSuffix, MatInput, MatSelect, MatOption,
  ],
  providers: [SaleStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sell.page.html',
  styleUrl: './sell.page.scss',
  host: { '(document:keydown)': 'onKey($event)' },
})
export class SellPage {
  protected readonly sale = inject(SaleStore);
  private readonly api = inject(SalesApi);
  private readonly customers = inject(CustomersApi);
  private readonly picker = inject(CustomerPicker);
  private readonly editor = inject(PriceEditor);
  protected readonly session = inject(SessionStore);
  private readonly confirm = inject(Confirm);
  private readonly notify = inject(Notify);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly compact = mediaQuery(COMPACT);
  protected readonly step = signal<'products' | 'cart'>('products');
  protected readonly mode = signal<'cart' | 'payment'>('cart');
  protected readonly notice = signal<string | null>(null);

  // Product search
  protected readonly query = signal('');
  protected readonly results = signal<Product[]>([]);
  protected readonly searching = signal(false);
  protected readonly searchError = signal<string | null>(null);
  protected readonly active = signal(0);
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private searchGeneration = 0;

  // Terms
  protected readonly taxRates = signal<TaxRate[]>([]);
  protected discountText = this.sale.discountMinor() ? formatMoney(this.sale.discountMinor(), this.session.money(), { withCode: false }) : '';
  protected readonly discountError = signal<string | null>(null);
  protected readonly quoteSubmission = new Submission();

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly customerName = computed(() => {
    const c = this.sale.customer();
    return c ? customerLabel(c) : null;
  });
  protected readonly preview = computed(() => (this.sale.previewCurrent() ? this.sale.preview() : null));
  protected readonly previewMessage = computed(() => {
    const f = this.sale.previewFailure();
    return f ? describeFailure(f) : null;
  });

  constructor() {
    void this.search();
    void this.loadTaxRates();
    effect(() => {
      const p = this.params();
      const customerId = p.get('customer');
      const quotationId = p.get('quotation');
      untracked(() => {
        if (quotationId) void this.convert(quotationId);
        else if (customerId) void this.presetCustomer(customerId);
      });
    });
  }

  // ---- products ----
  protected onQuery(text: string): void {
    this.query.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.search(), 250);
  }

  private async search(): Promise<void> {
    const generation = ++this.searchGeneration;
    this.searching.set(true);
    this.searchError.set(null);
    try {
      const found = await this.api.sellable(this.query().trim());
      if (generation !== this.searchGeneration) return;
      this.results.set(found);
      this.active.set(0);
    } catch (e) {
      if (generation === this.searchGeneration) this.searchError.set(describeFailure(toApiFailure(e)));
    } finally {
      if (generation === this.searchGeneration) this.searching.set(false);
    }
  }

  protected onSearchKey(event: KeyboardEvent): void {
    const count = this.results().length;
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      this.active.update((i) => (i + 1) % count);
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault();
      this.active.update((i) => (i - 1 + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const product = this.results()[this.active()];
      if (product) void this.add(product);
    }
  }

  /** "/" jumps to product search, as on the mobile app's keyboard shortcut list. */
  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (event.key === '/' && !typing && this.mode() === 'cart') {
      event.preventDefault();
      this.step.set('products');
      this.searchInput()?.nativeElement.focus();
    }
  }

  protected async add(product: Product): Promise<void> {
    const result = await this.editor.open({ product, quantity: 1, unitPriceMinor: product.listPriceMinor, belowMinimumReason: null, editing: false });
    if (!result) return;
    if (!this.sale.addLine(product, result.quantity, result.unitPriceMinor, result.belowMinimumReason)) {
      this.notify.error('A sale can have at most 100 different lines. Issue this one and start another for the rest.');
      return;
    }
    this.notice.set(null);
    this.notify.success(`${product.name} added.`);
  }

  protected async edit(line: CartLine): Promise<void> {
    let product: Product;
    try {
      product = await this.api.product(line.productId);
    } catch (e) {
      this.notify.error(describeFailure(toApiFailure(e)));
      return;
    }
    const result = await this.editor.open({ product, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor, belowMinimumReason: line.belowMinimumReason, editing: true });
    if (!result) return;
    this.sale.updateLine(line.key, { ...result, floorPriceMinor: product.floorPriceMinor, ceilingPriceMinor: product.ceilingPriceMinor });
  }

  protected remove(line: CartLine): void {
    this.sale.removeLine(line.key);
  }

  // ---- customer ----
  protected async chooseCustomer(): Promise<void> {
    const c = await this.picker.choose();
    if (c) this.sale.setCustomer(c);
  }

  private async presetCustomer(id: string): Promise<void> {
    if (this.sale.customer()?.id === id) return;
    try {
      const c = await this.customers.get(id);
      if (!c.archivedAt) this.sale.setCustomer(c);
    } catch (e) {
      this.notify.error(describeFailure(toApiFailure(e)));
    }
  }

  // ---- quotation conversion ----
  private async convert(id: string): Promise<void> {
    if (this.sale.quotation()?.id === id) return;
    let q: Quotation;
    try {
      q = await this.api.quotation(id);
    } catch (e) {
      this.notify.error(describeFailure(toApiFailure(e)));
      return;
    }
    if (q.status !== 'OPEN') {
      this.notice.set(`${q.number} cannot be converted: it is ${q.status === 'CONVERTED' ? 'already converted' : q.status === 'EXPIRED' ? 'expired' : 'cancelled'}.`);
      return;
    }
    if (!this.sale.isEmpty()) {
      const yes = await this.confirm.ask({ title: `Convert ${q.number}?`, message: 'The sale in progress will be replaced by the quotation.', confirmLabel: 'Replace' });
      if (!yes) return;
    }
    this.sale.loadQuotation(q);
    this.discountText = q.discountMinor ? formatMoney(q.discountMinor, this.session.money(), { withCode: false }) : '';
  }

  // ---- terms ----
  private async loadTaxRates(): Promise<void> {
    try {
      const rates = (await this.api.taxRates()).filter((r) => r.isActive);
      this.taxRates.set(rates);
      const current = this.sale.taxRateId();
      if (!current || !rates.some((r) => r.id === current)) {
        const fallback = rates.find((r) => r.isDefault) ?? rates[0];
        // Only when the cart has no rate yet; a converted quotation keeps its own.
        if (!current && fallback) this.sale.setTaxRate(fallback.id);
      }
    } catch (e) {
      this.notify.error(describeFailure(toApiFailure(e)));
    }
  }

  /** "VAT 5%"; the rate is added only when the rate's own name does not already show it. */
  protected rateLabel(r: Pick<TaxRate, 'name' | 'rateBp'>): string {
    const rate = formatBasisPoints(r.rateBp);
    return r.name.includes(rate) ? r.name : `${r.name} ${rate}`;
  }

  protected onDiscount(text: string): void {
    this.discountText = text;
    const trimmed = text.trim();
    const minor = trimmed ? parseMoney(trimmed, { exponent: this.session.money().exponent }) : 0;
    if (minor === null) {
      this.discountError.set('Enter an amount, for example 100.00.');
      return;
    }
    this.discountError.set(null);
    if (minor !== this.sale.discountMinor()) this.sale.setDiscount(minor);
  }

  protected async clearSale(): Promise<void> {
    if (this.sale.isEmpty()) return;
    const yes = await this.confirm.ask({ title: 'Clear this sale?', message: 'The products, customer and terms of this sale will be removed.', confirmLabel: 'Clear sale', danger: true });
    if (!yes) return;
    this.reset();
  }

  private reset(): void {
    this.sale.clear();
    this.discountText = '';
    this.discountError.set(null);
    this.mode.set('cart');
    this.step.set('products');
    if (this.params().keys.length) void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  // ---- outcomes ----
  protected takePayment(): void {
    if (this.sale.paymentBlocker()) return;
    this.mode.set('payment');
  }

  protected backToCart(): void {
    this.mode.set('cart');
    this.step.set('cart');
    const f = this.sale.submission.failure();
    if (f) this.notice.set(`${describeFailure(f)} Nothing was saved. The problems are shown on the lines.`);
  }

  protected completed(invoice: Invoice): void {
    this.notify.success(`Invoice ${invoice.number} issued.`);
    this.reset();
    void this.router.navigate(['/documents/invoices', invoice.id]);
  }

  protected async saveQuotation(): Promise<void> {
    const body = this.sale.body();
    const customer = this.sale.customer();
    if (!body || !customer || this.sale.quotationBlocker()) return;
    const quotation = await this.quoteSubmission.run((key) =>
      this.api.createQuotation({ ...body, customerId: customer.id, notes: this.sale.notes().trim() || null }, key),
    );
    if (quotation) {
      this.notify.success(`Quotation ${quotation.number} saved.`);
      this.reset();
      void this.router.navigate(['/documents/quotations', quotation.id]);
      return;
    }
    const f = this.quoteSubmission.failure();
    if (f) this.notice.set(this.quoteSubmission.unconfirmed() ? 'We could not confirm the quotation — the connection dropped. Save again: it will not be created twice.' : describeFailure(f));
  }

  // ---- an invoice sent earlier whose answer never arrived (kept across reloads) ----
  protected readonly retrying = signal(false);
  protected readonly pendingMessage = signal<string | null>(null);

  protected async retryPending(): Promise<void> {
    const pending = this.sale.pending();
    if (!pending || this.retrying()) return;
    this.retrying.set(true);
    this.pendingMessage.set(null);
    try {
      const invoice = await this.sale.submitInvoice(pending.body);
      if (invoice) return this.completed(invoice);
      const f = this.sale.submission.failure();
      if (this.sale.pending()) {
        this.pendingMessage.set('Still no answer from Velora. Check the connection and retry — the sale will not be recorded twice.');
      } else if (f) {
        // A definite refusal: nothing was recorded; the cart is editable again.
        this.notice.set(`${describeFailure(f)} Nothing was saved. The problems are shown on the lines.`);
      }
    } finally {
      this.retrying.set(false);
    }
  }

  protected async discardPending(): Promise<void> {
    const yes = await this.confirm.ask({
      title: 'Edit the sale instead?',
      message: 'If the earlier attempt reached Velora, the invoice already exists and is listed in Documents — check there first, or the sale may be recorded twice.',
      confirmLabel: 'I checked — edit the sale',
      cancelLabel: 'Keep waiting',
      danger: true,
    });
    if (yes) this.sale.discardPending();
  }

  protected pendingTotalItems(): number {
    return this.sale.pending()?.body.lines.reduce((n, l) => n + l.quantity, 0) ?? 0;
  }

  // ---- display helpers ----
  protected money(minor: number | null | undefined): string {
    return minor === null || minor === undefined ? '—' : formatMoney(minor, this.session.money());
  }

  protected lineTotal(index: number): string | null {
    const line = this.preview()?.lines[index];
    return line ? this.money(line.lineTotalMinor) : null;
  }

  protected issueText(issue: Issue): string {
    switch (issue.code) {
      case 'INSUFFICIENT_STOCK':
        return `Only ${issue.available ?? 0} in stock`;
      case 'PRICE_BELOW_MINIMUM':
        return `Below the lowest price${issue.floorPriceMinor !== undefined ? ` (${this.money(issue.floorPriceMinor)})` : ''}`;
      case 'PRICE_ABOVE_MAXIMUM':
        return `Above the highest price${issue.ceilingPriceMinor !== undefined ? ` (${this.money(issue.ceilingPriceMinor)})` : ''}`;
      default:
        return 'No longer available — remove it';
    }
  }

}
