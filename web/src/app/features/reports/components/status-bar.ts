import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export interface Part {
  key: string;
  label: string;
  /** CSS color of the block (a chart token); identity is also given by the label and legend. */
  color: string;
  /** Text color printed on the block: white, or near-black on light fills. */
  ink: string;
  value: number;
  /** Shown in the tooltip and the accessible name, e.g. "3 invoices · AED 12,400.00". */
  detail: string;
}

/**
 * Tall segmented bar (docs: dataviz "segmented bar"): one whole split into parts, widths
 * proportional to the values, each block's share printed inside when it fits. 28px tall, 4px
 * corners, 2px surface gaps. The legend and the figures table beside it name the parts, so
 * identity never depends on color alone. Hover or keyboard focus shows each part's figures.
 */
@Component({
  selector: 'app-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar" role="group" [attr.aria-label]="summary()" data-testid="status-bar">
      @for (p of parts(); track p.key) {
        <div
          class="block"
          role="img"
          tabindex="0"
          [style.flex-grow]="p.value"
          [style.background]="p.color"
          [style.color]="p.ink"
          [attr.aria-label]="p.label + ': ' + p.share + ' · ' + p.detail"
          (mouseenter)="hovered.set(p.key)"
          (mouseleave)="hovered.set(null)"
          (focus)="hovered.set(p.key)"
          (blur)="hovered.set(null)"
          [attr.data-testid]="'status-block-' + p.key"
        >
          @if (p.fraction >= 0.08) {
            <span aria-hidden="true">{{ p.share }}</span>
          }
        </div>
      }
    </div>
    <p class="tooltip t-body-sm" role="status" aria-live="polite">
      @if (active(); as a) {
        <strong>{{ a.label }}</strong> · {{ a.share }} · {{ a.detail }}
      } @else {
        <span class="t-muted">Point at a part for its figures.</span>
      }
    </p>
  `,
  styles: `
    :host { display: block; }
    .bar { display: flex; gap: 2px; height: 28px; background: var(--color-surface); }
    .block { min-width: 0; flex-basis: 0; border-radius: 4px; display: flex; align-items: center; padding-left: var(--space-2); overflow: hidden; font: 600 12px/1 var(--font-ui); cursor: default; outline-offset: 2px; }
    .block:focus-visible { outline: 2px solid var(--color-focus); }
    .tooltip { margin: var(--space-2) 0 0; min-height: 20px; }
  `,
})
export class StatusBar {
  readonly items = input.required<Omit<Part, never>[]>();
  readonly description = input.required<string>();
  protected readonly hovered = signal<string | null>(null);

  protected readonly parts = computed(() => {
    const all = this.items();
    const total = all.reduce((s, p) => s + p.value, 0);
    return all
      .filter((p) => p.value > 0) // a part at zero draws nothing
      .map((p) => {
        const fraction = total > 0 ? p.value / total : 0;
        return { ...p, fraction, share: `${Math.round(fraction * 100)}%` };
      });
  });
  protected readonly active = computed(() => this.parts().find((p) => p.key === this.hovered()) ?? null);
  protected readonly summary = computed(() => `${this.description()}: ${this.parts().map((p) => `${p.label} ${p.share}`).join(', ')}`);
}
