import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

/** The one status label of the app: invoices, quotations, stock levels, team members. */
@Component({
  selector: 'app-status-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pill', '[attr.data-tone]': 'tone()' },
  template: `{{ label() }}`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      padding: 2px var(--space-3);
      border-radius: var(--radius-full);
      font: 600 12px/20px var(--font-ui);
      white-space: nowrap;
      color: var(--status-neutral-fg);
      background: var(--status-neutral-bg);
    }
    :host([data-tone='success']) { color: var(--status-success-fg); background: var(--status-success-bg); }
    :host([data-tone='warning']) { color: var(--status-warning-fg); background: var(--status-warning-bg); }
    :host([data-tone='danger']) { color: var(--status-danger-fg); background: var(--status-danger-bg); }
  `,
})
export class StatusPill {
  readonly label = input.required<string>();
  readonly tone = input<Tone>('neutral');
}
