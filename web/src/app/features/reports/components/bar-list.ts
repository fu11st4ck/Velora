import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** The value as printed, e.g. "AED 12,400.00". */
  valueText: string;
  /** Secondary figures, e.g. "4 invoices · profit AED 2,100.00". */
  detail: string;
}

/**
 * Ranked horizontal bars for one measure (single series: one hue, no legend — the heading names
 * it). Thin bars with rounded data ends from a shared baseline; values printed at the end of each
 * row in text ink; hover or focus highlights a row and repeats its figures.
 */
@Component({
  selector: 'app-bar-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="rows">
      @for (r of rows(); track r.key) {
        <li
          tabindex="0"
          [class.active]="hovered() === r.key"
          (mouseenter)="hovered.set(r.key)"
          (mouseleave)="hovered.set(null)"
          (focus)="hovered.set(r.key)"
          (blur)="hovered.set(null)"
          [attr.aria-label]="r.label + ': ' + r.valueText + ' · ' + r.detail"
          data-testid="bar-row"
        >
          <div class="head">
            <span class="label">{{ r.label }}</span>
            <span class="value">{{ r.valueText }}</span>
          </div>
          <div class="track" aria-hidden="true"><div class="fill" [style.width.%]="r.width"></div></div>
          <span class="t-body-sm t-muted">{{ r.detail }}</span>
        </li>
      }
    </ol>
  `,
  styles: `
    .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); }
    li { padding: var(--space-2); margin: 0 calc(-1 * var(--space-2)); border-radius: var(--radius-md); outline-offset: 0; }
    li.active { background: var(--color-page); }
    li:focus-visible { outline: 2px solid var(--color-focus); }
    .head { display: flex; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-1); }
    .label { font-weight: 600; }
    .value { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
    .track { height: 8px; }
    .fill { height: 8px; min-width: 2px; border-radius: 0 4px 4px 0; background: var(--chart-series-1); }
  `,
})
export class BarList {
  readonly items = input.required<BarRow[]>();
  protected readonly hovered = signal<string | null>(null);
  protected readonly rows = computed(() => {
    const max = Math.max(0, ...this.items().map((r) => r.value));
    return this.items().map((r) => ({ ...r, width: max > 0 ? Math.max(0, (r.value / max) * 100) : 0 }));
  });
}
