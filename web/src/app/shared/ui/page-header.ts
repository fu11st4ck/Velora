import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Page title, one context line, and the page's actions on the right. */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="text">
      @if (overline()) {
        <p class="t-overline">{{ overline() }}</p>
      }
      <h1 class="t-title-lg" tabindex="-1" id="page-title">{{ heading() }}</h1>
      @if (subtitle()) {
        <p class="t-muted">{{ subtitle() }}</p>
      }
    </div>
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-6); }
    p { margin: 0; }
    h1:focus { outline: none; }
    .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  `,
})
export class PageHeader {
  readonly heading = input.required<string>();
  readonly overline = input<string | null>(null);
  readonly subtitle = input<string | null>(null);
}
