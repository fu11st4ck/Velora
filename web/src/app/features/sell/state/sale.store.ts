import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toApiFailure, type ApiFailure } from '../../../core/api/api-failure';
import type { Customer, PricingPreview, Product, Quotation } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { SAVED_SALE_PREFIX } from '../../../core/state/saved-sale';
import { Submission } from '../../../core/state/submission';
import { SalesApi, type PricingBody } from '../data/sales.api';

/** One line of the cart. Never holds cost: what is saved in the browser is what a salesperson may see. */
export interface CartLine {
  /** Local identity of the line on screen. */
  key: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  /** Price limits as last read from the server, shown in the price editor; the server re-checks them. */
  floorPriceMinor: number | null;
  ceilingPriceMinor: number | null;
  belowMinimumReason: string | null;
}

export type CartCustomer = Pick<Customer, 'id' | 'name' | 'company' | 'mobile'>;

export interface SaleState {
  lines: CartLine[];
  customer: CartCustomer | null;
  discountMinor: number;
  taxRateId: string | null;
  notes: string;
  /** Set when the sale converts a quotation. */
  quotation: { id: string; number: string } | null;
}

const EMPTY: SaleState = { lines: [], customer: null, discountMinor: 0, taxRateId: null, notes: '', quotation: null };
const PREVIEW_DELAY_MS = 250;
const MAX_LINES = 100;

function restore(key: string | null): SaleState {
  if (!key) return EMPTY;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<SaleState>;
    const lines = Array.isArray(v.lines)
      ? v.lines.filter((l): l is CartLine => typeof l?.productId === 'string' && Number.isInteger(l.quantity) && Number.isInteger(l.unitPriceMinor))
      : [];
    return {
      lines: lines.map((l) => ({ ...l, key: l.key ?? crypto.randomUUID(), belowMinimumReason: l.belowMinimumReason ?? null, floorPriceMinor: l.floorPriceMinor ?? null, ceilingPriceMinor: l.ceilingPriceMinor ?? null })),
      customer: v.customer && typeof v.customer.id === 'string' ? v.customer : null,
      discountMinor: Number.isInteger(v.discountMinor) ? (v.discountMinor as number) : 0,
      taxRateId: typeof v.taxRateId === 'string' ? v.taxRateId : null,
      notes: typeof v.notes === 'string' ? v.notes : '',
      quotation: v.quotation && typeof v.quotation.id === 'string' ? v.quotation : null,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * The sale in progress (docs/web-state-management.md §5). Provided on the /sell route and saved per
 * user in this browser, so a reload or an expired session does not lose it. Totals and per-line
 * problems come only from the server's preview; this store never computes a price.
 */
@Injectable()
export class SaleStore {
  private readonly api = inject(SalesApi);
  private readonly session = inject(SessionStore);
  private readonly storageKey = computed(() => {
    const id = this.session.me()?.user.id;
    return id ? `${SAVED_SALE_PREFIX}${id}` : null;
  });

  private readonly state = signal<SaleState>(restore(this.storageKey()));
  readonly lines = computed(() => this.state().lines);
  readonly customer = computed(() => this.state().customer);
  readonly discountMinor = computed(() => this.state().discountMinor);
  readonly taxRateId = computed(() => this.state().taxRateId);
  readonly notes = computed(() => this.state().notes);
  readonly quotation = computed(() => this.state().quotation);
  readonly isEmpty = computed(() => this.state().lines.length === 0 && !this.state().customer);
  readonly itemCount = computed(() => this.state().lines.reduce((n, l) => n + l.quantity, 0));

  /** One key per intended sale; a new one whenever the sale changes (docs/web-state-management.md §6). */
  readonly submission = new Submission();

  // Server preview of the current cart.
  readonly preview = signal<PricingPreview | null>(null);
  readonly previewFailure = signal<ApiFailure | null>(null);
  readonly previewing = signal(false);
  private previewedFor = signal<string | null>(null);
  readonly body = computed<PricingBody | null>(() => {
    const s = this.state();
    if (s.lines.length === 0) return null;
    return {
      lines: s.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, ...(l.belowMinimumReason ? { belowMinimumReason: l.belowMinimumReason } : {}) })),
      discountMinor: s.discountMinor,
      ...(s.taxRateId ? { taxRateId: s.taxRateId } : {}),
    };
  });
  /** The preview answers exactly the cart on screen (not an earlier version of it). */
  readonly previewCurrent = computed(() => {
    const body = this.body();
    return !!body && this.previewedFor() === JSON.stringify(body) && !!this.preview();
  });
  readonly lineIssues = computed(() => {
    const preview = this.previewCurrent() ? this.preview() : null;
    return this.state().lines.map((_, i) => preview?.lines[i]?.issues ?? []);
  });
  /** Problems that also stop a quotation (stock is not checked for quotations, rule D4). */
  readonly priceProblems = computed(() => this.lineIssues().some((issues) => issues.some((i) => i.code !== 'INSUFFICIENT_STOCK')));

  /** Why payment cannot be taken yet, or null when it can. */
  readonly paymentBlocker = computed<string | null>(() => {
    if (this.state().lines.length === 0) return 'Add a product to start.';
    if (!this.state().customer) return 'Choose a customer.';
    if (this.previewFailure()) return 'The totals could not be calculated. Check the discount and try again.';
    if (!this.previewCurrent()) return 'Updating totals…';
    if (!this.preview()?.valid) return 'Fix the problems shown on the lines.';
    return null;
  });
  readonly quotationBlocker = computed<string | null>(() => {
    if (this.state().quotation) return 'This sale converts a quotation.';
    if (this.state().lines.length === 0) return 'Add a product to start.';
    if (!this.state().customer) return 'Choose a customer.';
    if (this.previewFailure()) return 'The totals could not be calculated.';
    if (!this.previewCurrent()) return 'Updating totals…';
    if (this.priceProblems()) return 'Fix the prices shown on the lines.';
    return null;
  });

  constructor() {
    // Save every change, per user (try/catch: storage may be unavailable).
    effect(() => {
      const key = this.storageKey();
      const state = this.state();
      if (!key) return;
      try {
        if (state.lines.length === 0 && !state.customer && !state.quotation) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // Kept in memory for this visit.
      }
    });

    // Ask the server for totals and line problems, a moment after the cart stops changing.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    effect(() => {
      const body = this.body();
      clearTimeout(timer);
      untracked(() => {
        if (!body) {
          this.preview.set(null);
          this.previewFailure.set(null);
          this.previewedFor.set(null);
          return;
        }
        const request = ++generation;
        this.previewing.set(true);
        timer = setTimeout(() => {
          this.api.preview(body).then(
            (preview) => {
              if (request !== generation) return;
              this.preview.set(preview);
              this.previewFailure.set(null);
              this.previewedFor.set(JSON.stringify(body));
              this.previewing.set(false);
            },
            (error: unknown) => {
              if (request !== generation) return;
              this.previewFailure.set(toApiFailure(error));
              this.previewing.set(false);
            },
          );
        }, PREVIEW_DELAY_MS);
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  private update(change: (s: SaleState) => SaleState): void {
    this.state.update(change);
    this.submission.inputChanged();
  }

  /** Same product at the same price adds to that line; otherwise a new line. */
  addLine(product: Pick<Product, 'id' | 'name' | 'sku' | 'floorPriceMinor' | 'ceilingPriceMinor'>, quantity: number, unitPriceMinor: number, belowMinimumReason: string | null): void {
    this.update((s) => {
      const same = s.lines.find((l) => l.productId === product.id && l.unitPriceMinor === unitPriceMinor && l.belowMinimumReason === belowMinimumReason);
      if (same) return { ...s, lines: s.lines.map((l) => (l === same ? { ...l, quantity: l.quantity + quantity } : l)) };
      if (s.lines.length >= MAX_LINES) return s;
      const line: CartLine = {
        key: crypto.randomUUID(), productId: product.id, name: product.name, sku: product.sku, quantity, unitPriceMinor,
        floorPriceMinor: product.floorPriceMinor, ceilingPriceMinor: product.ceilingPriceMinor, belowMinimumReason,
      };
      return { ...s, lines: [...s.lines, line] };
    });
  }

  updateLine(key: string, changes: Partial<Pick<CartLine, 'quantity' | 'unitPriceMinor' | 'belowMinimumReason' | 'floorPriceMinor' | 'ceilingPriceMinor'>>): void {
    this.update((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...changes } : l)) }));
  }

  removeLine(key: string): void {
    this.update((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) }));
  }

  setCustomer(customer: CartCustomer | null): void {
    this.update((s) => ({ ...s, customer: customer ? { id: customer.id, name: customer.name ?? null, company: customer.company ?? null, mobile: customer.mobile ?? null } : null }));
  }

  setDiscount(discountMinor: number): void {
    this.update((s) => ({ ...s, discountMinor }));
  }

  setTaxRate(taxRateId: string | null): void {
    this.update((s) => ({ ...s, taxRateId }));
  }

  setNotes(notes: string): void {
    this.update((s) => ({ ...s, notes }));
  }

  /** Replaces the cart with an open quotation's lines, customer and terms. */
  loadQuotation(q: Quotation): void {
    this.update(() => ({
      lines: q.lines.map((l) => ({
        key: crypto.randomUUID(), productId: l.productId, name: l.name, sku: l.sku, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor,
        floorPriceMinor: null, ceilingPriceMinor: null, belowMinimumReason: null,
      })),
      customer: { id: q.customer.id, name: q.customer.name ?? null, company: q.customer.company ?? null, mobile: q.customer.mobile ?? null },
      discountMinor: q.discountMinor,
      taxRateId: q.tax.id ?? null,
      notes: q.notes ?? '',
      quotation: { id: q.id, number: q.number },
    }));
  }

  clear(): void {
    this.update(() => EMPTY);
  }
}
