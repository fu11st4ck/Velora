import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { toApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import type { Envelope, Page, Product, StockMovement } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatDateTime } from '../../../core/dates/dates';
import { formatBasisPoints, formatMoney } from '../../../core/money/money';
import { EntityVersions } from '../../../core/state/entity-versions';
import { Submission } from '../../../core/state/submission';
import { Confirm } from '../../../shared/ui/confirm-dialog';
import { Notify } from '../../../shared/ui/notify';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { StatusPill } from '../../../shared/ui/status-pill';
import { StockDialogs } from '../components/stock-dialogs';
import { InventoryApi } from '../data/inventory.api';
import { movementLabel, signedQuantity, stockLabel, valueAtCost, weightLabel } from '../data/labels';

/** W-C2 Product detail. */
@Component({
  selector: 'app-product-detail-page',
  imports: [PageHeader, StateView, Skeleton, StatusPill, MatButton, MatIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-detail.page.html',
  styleUrl: './product-detail.page.scss',
})
export class ProductDetailPage {
  readonly id = input.required<string>();
  private readonly session = inject(SessionStore);
  private readonly versions = inject(EntityVersions);
  private readonly api = inject(InventoryApi);
  private readonly confirm = inject(Confirm);
  private readonly notify = inject(Notify);
  private readonly router = inject(Router);
  protected readonly dialogs = inject(StockDialogs);
  protected readonly archiving = new Submission();

  protected readonly resource = httpResource<Envelope<Product>>(() => {
    this.versions.of('products')();
    this.versions.of('stock')();
    return `${environment.apiBaseUrl}/products/${encodeURIComponent(this.id())}`;
  });
  protected readonly movements = httpResource<Page<StockMovement>>(() => {
    this.versions.of('stock')();
    return { url: `${environment.apiBaseUrl}/inventory/movements`, params: { productId: this.id(), limit: 10 } };
  });

  protected readonly product = computed(() => (this.resource.hasValue() ? this.resource.value().data : null));
  protected readonly failure = computed(() => {
    const error = this.resource.error();
    if (!error) return null;
    const f = toApiFailure(error instanceof HttpErrorResponse ? error : (error.cause ?? error));
    return { kind: f.kind === 'notFound' ? ('notFound' as const) : f.kind === 'forbidden' ? ('forbidden' as const) : ('error' as const), message: describeFailure(f) };
  });
  protected readonly movementsFailure = computed(() => {
    const error = this.movements.error();
    return error ? describeFailure(toApiFailure(error)) : null;
  });

  protected readonly canStock = computed(() => this.session.can('inventory.manage') && !this.product()?.archivedAt);
  protected readonly canManage = computed(() => this.session.can('product.manage') && !this.product()?.archivedAt);
  protected readonly seesCost = computed(() => this.session.can('product.read_cost'));
  private readonly tz = computed(() => this.session.me()?.settings.timezone ?? 'UTC');

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
  protected when(iso: string): string {
    return formatDateTime(iso, this.tz());
  }
  protected type(m: StockMovement): string {
    return movementLabel(m.type);
  }
  protected delta(m: StockMovement): string {
    return signedQuantity(m.quantityDelta);
  }

  protected async archive(p: Product): Promise<void> {
    const yes = await this.confirm.ask({
      title: 'Archive this product?',
      message: `${p.name} will no longer appear in product lists or be available for sale. Its history and documents are kept.`,
      confirmLabel: 'Archive',
      danger: true,
    });
    if (!yes) return;
    await this.archiving.run(() => this.api.archive(p.id));
    const f = this.archiving.failure();
    if (f) {
      this.notify.error(describeFailure(f));
      return;
    }
    this.notify.success(`${p.name} archived.`);
    void this.router.navigate(['/inventory']);
  }
}
