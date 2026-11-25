import { ScrollRegion } from '../../../shared/table/scroll-region';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatAutocomplete, MatAutocompleteTrigger, type MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatHint, MatLabel, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { Product, StockMovement } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { endOfDay, formatDateTime, startOfDay } from '../../../core/dates/dates';
import { formatMoney } from '../../../core/money/money';
import { EntityVersions } from '../../../core/state/entity-versions';
import { LoadMore } from '../../../shared/table/load-more';
import { COMPACT, mediaQuery } from '../../../shared/table/media';
import { PagedList } from '../../../shared/table/paged-list';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { InventoryApi, type MovementQuery, type MovementType } from '../data/inventory.api';
import { MOVEMENT_TYPES, movementLabel, signedQuantity } from '../data/labels';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * W-C6 Stock history. Dates are business days in the organization's time zone; the API filters on
 * instants, so each day is converted to its exact start and end there (not in the browser's zone).
 */
@Component({
  selector: 'app-stock-history-page',
  imports: [ScrollRegion, 
    FormsModule, RouterLink, PageHeader, StateView, Skeleton, LoadMore,
    MatButton, MatIconButton, MatIcon, MatFormField, MatLabel, MatHint, MatPrefix, MatSuffix, MatInput, MatSelect, MatOption, MatAutocomplete, MatAutocompleteTrigger,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stock-history.page.html',
  styleUrl: './stock-history.page.scss',
})
export class StockHistoryPage {
  private readonly api = inject(InventoryApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  private readonly versions = inject(EntityVersions);

  protected readonly compact = mediaQuery(COMPACT);
  protected readonly types = MOVEMENT_TYPES;
  protected readonly seesCost = computed(() => this.session.can('product.read_cost'));
  protected readonly list = new PagedList<StockMovement>();
  private readonly tz = computed(() => this.session.me()?.settings.timezone ?? 'UTC');

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly filters = computed(() => {
    const p = this.params();
    const product = p.get('product');
    const from = p.get('from');
    const to = p.get('to');
    const types = (p.get('type') ?? '').split(',').filter((t): t is MovementType => MOVEMENT_TYPES.some((m) => m.value === t));
    return {
      productId: product && UUID.test(product) ? product : null,
      types,
      from: from && DATE.test(from) ? from : null,
      to: to && DATE.test(to) ? to : null,
    };
  });
  protected readonly rangeInvalid = computed(() => {
    const f = this.filters();
    return !!f.from && !!f.to && f.from > f.to;
  });

  /** The product chosen as a filter, fetched so its name can be shown. */
  protected readonly selectedProduct = signal<Pick<Product, 'id' | 'name' | 'sku'> | null>(null);
  protected productText = '';
  protected readonly suggestions = signal<Product[]>([]);
  private suggestTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const f = this.filters();
      this.versions.of('stock')();
      const tz = this.tz();
      untracked(() => {
        if (this.rangeInvalid()) return;
        const query: MovementQuery = {
          productId: f.productId ?? undefined,
          types: f.types,
          from: f.from ? startOfDay(f.from, tz).toISOString() : undefined,
          to: f.to ? endOfDay(f.to, tz).toISOString() : undefined,
          limit: 50,
        };
        void this.list.load((cursor) => this.api.movements(query, cursor));
      });
    });
    effect(() => {
      const id = this.filters().productId;
      untracked(() => {
        if (!id) {
          this.selectedProduct.set(null);
          return;
        }
        if (this.selectedProduct()?.id === id) return;
        this.api.product(id).then(
          (p) => this.selectedProduct.set(p),
          () => this.selectedProduct.set({ id, name: 'Unknown product', sku: '' }),
        );
      });
    });
  }

  protected navigate(changes: Record<string, string | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: changes, queryParamsHandling: 'merge' });
  }

  protected onProductText(text: string): void {
    this.productText = text;
    clearTimeout(this.suggestTimer);
    if (!text.trim()) {
      this.suggestions.set([]);
      return;
    }
    this.suggestTimer = setTimeout(() => {
      this.api.products({ q: text.trim(), includeArchived: this.session.can('product.manage'), limit: 8 }, null).then(
        (page) => this.suggestions.set(page.data),
        () => this.suggestions.set([]),
      );
    }, 250);
  }

  protected chooseProduct(event: MatAutocompleteSelectedEvent): void {
    const p = event.option.value as Product;
    this.selectedProduct.set(p);
    this.productText = '';
    this.suggestions.set([]);
    this.navigate({ product: p.id });
  }

  protected clearProduct(): void {
    this.selectedProduct.set(null);
    this.navigate({ product: null });
  }

  protected setTypes(types: MovementType[]): void {
    this.navigate({ type: types.length ? types.join(',') : null });
  }

  protected setDate(which: 'from' | 'to', value: string): void {
    this.navigate({ [which]: DATE.test(value) ? value : null });
  }

  protected clearFilters(): void {
    this.productText = '';
    this.navigate({ product: null, type: null, from: null, to: null });
  }

  protected readonly filtered = computed(() => {
    const f = this.filters();
    return !!f.productId || f.types.length > 0 || !!f.from || !!f.to;
  });
  protected readonly failure = computed(() => {
    const f = this.list.failure();
    return f ? describeFailure(toApiFailure(f)) : null;
  });

  protected when(m: StockMovement): string {
    return formatDateTime(m.createdAt, this.tz());
  }
  protected type(m: StockMovement): string {
    return movementLabel(m.type);
  }
  protected delta(m: StockMovement): string {
    return signedQuantity(m.quantityDelta);
  }
  protected cost(m: StockMovement): string {
    return m.unitCostMinor === undefined || m.unitCostMinor === null ? '—' : formatMoney(m.unitCostMinor, this.session.money());
  }
  /** Everything but the invoice number (which is a link). */
  protected otherReference(m: StockMovement): string {
    const parts = [m.return?.number, m.supplierName, m.referenceNote, m.reason].filter((x): x is string => !!x);
    if (parts.length === 0) return m.invoice ? '' : '—';
    return `${m.invoice ? ' · ' : ''}${parts.join(' · ')}`;
  }

  /** What the movement refers to: the document number, or the receipt's supplier and note, or the adjustment reason. */
  protected reference(m: StockMovement): string {
    const parts = [m.invoice?.number, m.return?.number, m.supplierName, m.referenceNote, m.reason].filter((x): x is string => !!x);
    return parts.join(' · ') || '—';
  }
}
