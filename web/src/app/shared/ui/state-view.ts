import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

export type StateKind = 'empty' | 'error' | 'forbidden' | 'notFound';

const ICONS: Record<StateKind, string> = { empty: 'inventory_2', error: 'cloud_off', forbidden: 'lock', notFound: 'search_off' };

/** Empty, error, forbidden and not-found states (docs/web-component-inventory.md §1.4). */
@Component({
  selector: 'app-state-view',
  imports: [MatButton, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>
    <h2 class="t-title-md">{{ heading() }}</h2>
    @if (message()) {
      <p class="t-muted">{{ message() }}</p>
    }
    @if (actionLabel()) {
      <button matButton="outlined" type="button" (click)="action.emit()">{{ actionLabel() }}</button>
    }
    <ng-content />
  `,
  host: { '[attr.role]': "kind() === 'error' ? 'alert' : null" },
  styles: `
    :host { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--space-2); padding: var(--space-12) var(--space-4); }
    mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--color-text-muted); }
    p { margin: 0; max-width: 46ch; }
    button { margin-top: var(--space-3); }
  `,
})
export class StateView {
  readonly kind = input<StateKind>('empty');
  readonly heading = input.required<string>();
  readonly message = input<string | null>(null);
  readonly actionLabel = input<string | null>(null);
  readonly action = output<void>();
  protected icon() {
    return ICONS[this.kind()];
  }
}
