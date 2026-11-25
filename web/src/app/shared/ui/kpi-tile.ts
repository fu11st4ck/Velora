import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/** A headline figure. `value` null means the figure is withheld from this role. */
@Component({
  selector: 'app-kpi-tile',
  imports: [MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="t-overline">{{ label() }}</p>
    @if (value() === null) {
      <p class="locked"><mat-icon aria-hidden="true">lock</mat-icon><span>{{ lockedText() }}</span></p>
    } @else {
      <p class="t-money-lg value">{{ value() }}</p>
    }
    @for (line of lines(); track $index) {
      <p class="t-body-sm t-muted">{{ line }}</p>
    }
    @if (alert()) {
      <p class="t-body-sm alert">{{ alert() }}</p>
    }
  `,
  styles: `
    :host { display: block; padding: var(--space-5); background: var(--color-surface); border: 1px solid var(--color-line); border-radius: var(--radius-md); box-shadow: var(--shadow-1); min-width: 0; }
    p { margin: 0; }
    .value { margin: var(--space-2) 0 var(--space-1); overflow-wrap: anywhere; }
    .locked { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-3) 0 var(--space-1); color: var(--color-text-muted); }
    .alert { color: var(--status-danger-fg); font-weight: 600; }
  `,
})
export class KpiTile {
  readonly label = input.required<string>();
  readonly value = input<string | null>(null);
  readonly lines = input<readonly string[]>([]);
  readonly alert = input<string | null>(null);
  readonly lockedText = input('Shown to managers');
}
