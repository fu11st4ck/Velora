import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import type { Product } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { StockDialogs } from './stock-dialogs';

/** Row actions for a product: only the ones the role may use, and none for archived products. */
@Component({
  selector: 'app-stock-actions',
  imports: [MatIconButton, MatIcon, MatMenu, MatMenuItem, MatMenuTrigger, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (any()) {
      <button matIconButton type="button" [matMenuTriggerFor]="menu" [attr.aria-label]="'Actions for ' + product().name" data-testid="product-actions">
        <mat-icon>more_vert</mat-icon>
      </button>
      <mat-menu #menu="matMenu" xPosition="before">
        @if (canStock()) {
          <button mat-menu-item type="button" (click)="dialogs.receive(product())" data-testid="action-receive"><mat-icon>move_to_inbox</mat-icon>Receive stock</button>
          <button mat-menu-item type="button" (click)="dialogs.adjust(product())" data-testid="action-adjust"><mat-icon>tune</mat-icon>Adjust stock</button>
        }
        @if (canManage()) {
          <a mat-menu-item [routerLink]="['/inventory', product().id, 'edit']" data-testid="action-edit"><mat-icon>edit</mat-icon>Edit product</a>
        }
      </mat-menu>
    }
  `,
})
export class StockActions {
  readonly product = input.required<Product>();
  protected readonly dialogs = inject(StockDialogs);
  private readonly session = inject(SessionStore);
  protected readonly canStock = computed(() => this.session.can('inventory.manage') && !this.product().archivedAt);
  protected readonly canManage = computed(() => this.session.can('product.manage') && !this.product().archivedAt);
  protected readonly any = computed(() => this.canStock() || this.canManage());
}
