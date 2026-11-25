import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatLabel, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSort, MatSortHeader, type Sort } from '@angular/material/sort';
import { MatCell, MatCellDef, MatColumnDef, MatHeaderCell, MatHeaderCellDef, MatHeaderRow, MatHeaderRowDef, MatRow, MatRowDef, MatTable } from '@angular/material/table';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { describeFailure } from '../../../core/api/messages';
import type { Product } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatBasisPoints, formatMoney } from '../../../core/money/money';
import { EntityVersions } from '../../../core/state/entity-versions';
import { ColumnChoice, type ColumnDef } from '../../../shared/table/columns';
import { LoadMore } from '../../../shared/table/load-more';
import { COMPACT, mediaQuery } from '../../../shared/table/media';
import { PagedList } from '../../../shared/table/paged-list';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { StatusPill } from '../../../shared/ui/status-pill';
import { StockActions } from '../components/stock-actions';
import { InventoryApi, type ProductListMeta, type ProductQuery, type ProductSort, type StockFilter } from '../data/inventory.api';
import { stockLabel, valueAtCost, weightLabel } from '../data/labels';

const SORTS: { value: ProductSort; label: string }[] = [
  { value: 'name', label: 'Name A–Z' },
  { value: '-name', label: 'Name Z–A' },
  { value: 'quantity', label: 'Lowest stock first' },
  { value: '-quantity', label: 'Highest stock first' },
  { value: '-createdAt', label: 'Newest first' },
];
const STOCK_FILTERS: StockFilter[] = ['in_stock', 'low', 'out', 'attention'];
const PAGE_SIZE = 25;

/** W-C1 Products. Filters live in the URL, so a filtered list can be bookmarked, shared and restored with Back. */
@Component({
  selector: 'app-products-page',
  imports: [
    FormsModule, RouterLink, PageHeader, StateView, Skeleton, StatusPill, LoadMore, StockActions,
    MatButton, MatIconButton, MatIcon, MatFormField, MatLabel, MatPrefix, MatSuffix, MatInput, MatSelect, MatOption, MatSlideToggle,
    MatMenu, MatMenuItem, MatMenuTrigger,
    MatTable, MatColumnDef, MatHeaderCell, MatHeaderCellDef, MatCell, MatCellDef, MatHeaderRow, MatHeaderRowDef, MatRow, MatRowDef, MatSort, MatSortHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './products.page.html',
  styleUrl: './products.page.scss',
})
export class ProductsPage {
  private readonly api = inject(InventoryApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  private readonly versions = inject(EntityVersions);

  protected readonly compact = mediaQuery(COMPACT);
  protected readonly sorts = SORTS;
  protected readonly canManage = computed(() => this.session.can('product.manage'));
  protected readonly canStock = computed(() => this.session.can('inventory.manage'));
  protected readonly seesCost = computed(() => this.session.can('product.read_cost'));
  protected readonly list = new PagedList<Product, ProductListMeta>();

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly query = computed<ProductQuery>(() => {
    const p = this.params();
    const stock = p.get('stock') as StockFilter | null;
    const sort = p.get('sort') as ProductSort | null;
    return {
      q: p.get('q')?.trim() || undefined,
      stockStatus: stock && STOCK_FILTERS.includes(stock) ? stock : undefined,
      includeArchived: p.get('archived') === '1' && this.canManage(),
      sort: sort && SORTS.some((s) => s.value === sort) ? sort : 'name',
      limit: PAGE_SIZE,
    };
  });
  protected searchText = this.params().get('q') ?? '';
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly columns = new ColumnChoice('velora.columns.products', () => [
    { id: 'product', label: 'Product', visibleByDefault: true, fixed: true },
    { id: 'barcode', label: 'Barcode', visibleByDefault: false },
    { id: 'weight', label: 'Weight', visibleByDefault: true },
    { id: 'available', label: 'Available', visibleByDefault: true, fixed: true },
    { id: 'list', label: 'List price', visibleByDefault: true },
    { id: 'floor', label: 'Floor price', visibleByDefault: false },
    ...(this.seesCost()
      ? [
          { id: 'cost', label: 'Cost', visibleByDefault: true },
          { id: 'markup', label: 'Markup', visibleByDefault: false },
          { id: 'value', label: 'Value at cost', visibleByDefault: true },
        ]
      : []),
  ]);
  protected readonly displayed = computed(() => [...this.columns.visible(), ...(this.canStock() || this.canManage() ? ['actions'] : [])]);

  protected readonly chips = computed(() => {
    const counts = this.list.meta()?.counts;
    const current = this.query().stockStatus ?? null;
    const chips: { value: StockFilter | null; label: string; count: number | undefined }[] = [
      { value: null, label: 'All', count: counts?.all },
      { value: 'in_stock', label: 'In stock', count: counts?.inStock },
      { value: 'low', label: 'Low', count: counts?.low },
      { value: 'out', label: 'Out', count: counts?.out },
    ];
    // "Needs attention" (low or out) is reached from the dashboard; it is shown only while active.
    if (current === 'attention') chips.push({ value: 'attention', label: 'Needs attention', count: (counts?.low ?? 0) + (counts?.out ?? 0) });
    return chips.map((c) => ({ ...c, selected: c.value === current }));
  });

  protected readonly matSort = computed(() => {
    const s = this.query().sort ?? 'name';
    const active = s.endsWith('name') ? 'product' : s.endsWith('quantity') ? 'available' : '';
    return { active, direction: (s.startsWith('-') ? 'desc' : 'asc') as 'asc' | 'desc' };
  });

  protected readonly failure = computed(() => {
    const f = this.list.failure();
    return f ? { kind: f.kind === 'forbidden' ? ('forbidden' as const) : ('error' as const), message: describeFailure(f) } : null;
  });
  protected readonly filtered = computed(() => {
    const q = this.query();
    return !!q.q || !!q.stockStatus || !!q.includeArchived;
  });

  constructor() {
    let lastKey = '';
    effect(() => {
      const query = this.query();
      // Any product or stock change made in this tab refreshes the list.
      this.versions.of('products')();
      this.versions.of('stock')();
      const key = JSON.stringify(query);
      untracked(() => {
        const fetch = (cursor: string | null) => this.api.products(query, cursor);
        void this.list.load(fetch, { keepItems: key === lastKey });
        lastKey = key;
      });
    });
  }

  protected navigate(changes: Record<string, string | null>, replaceUrl = false): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: changes, queryParamsHandling: 'merge', replaceUrl });
  }

  protected onSearch(text: string): void {
    this.searchText = text;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ q: text.trim() || null }, true), 300);
  }

  protected clearSearch(): void {
    this.searchText = '';
    clearTimeout(this.searchTimer);
    this.navigate({ q: null }, true);
  }

  protected setStock(value: StockFilter | null): void {
    this.navigate({ stock: value });
  }

  protected setSort(value: ProductSort): void {
    this.navigate({ sort: value === 'name' ? null : value });
  }

  protected onSortChange(sort: Sort): void {
    if (!sort.direction) return this.setSort('name');
    const field = sort.active === 'available' ? 'quantity' : 'name';
    this.setSort((sort.direction === 'desc' ? `-${field}` : field) as ProductSort);
  }

  protected setArchived(show: boolean): void {
    this.navigate({ archived: show ? '1' : null });
  }

  protected clearFilters(): void {
    this.searchText = '';
    this.navigate({ q: null, stock: null, archived: null });
  }

  protected toggleColumn(c: ColumnDef): void {
    this.columns.toggle(c);
  }

  protected money(minor: number | null | undefined): string {
    return minor === null || minor === undefined ? '—' : formatMoney(minor, this.session.money());
  }
  protected bp(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : formatBasisPoints(value);
  }
  protected status(p: Product) {
    return stockLabel(p);
  }
  protected weight(p: Product): string {
    return weightLabel(p.weight) || '—';
  }
  protected value(p: Product): string {
    return this.money(valueAtCost(p));
  }
}
