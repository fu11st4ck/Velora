import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Brand panel and form card for the signed-out pages. */
@Component({
  selector: 'app-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="brand" aria-hidden="true">
      <span class="mark"><span>V</span></span>
      <p class="wordmark">VELORA</p>
      <p class="tag">Sales &amp; Inventory</p>
    </aside>
    <main class="panel" id="main">
      <div class="card">
        <h1 class="t-title-lg" id="page-title" tabindex="-1">{{ heading() }}</h1>
        @if (subtitle()) {
          <p class="t-muted subtitle">{{ subtitle() }}</p>
        }
        <ng-content />
      </div>
    </main>
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(320px, 40%) 1fr; min-height: 100%; }
    .brand { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: var(--space-2); background: var(--sidebar-bg); color: var(--sidebar-text); }
    .mark { display: grid; place-items: center; width: 56px; height: 56px; border: 1px solid var(--brand-gold-300); transform: rotate(45deg); color: var(--brand-gold-300); font: 500 26px var(--font-display); margin-bottom: var(--space-6); }
    .mark > span { transform: rotate(-45deg); }
    .wordmark { margin: 0; font: 500 28px var(--font-display); letter-spacing: 0.35em; }
    .tag { margin: 0; color: var(--sidebar-text-muted); letter-spacing: 0.1em; }
    .panel { display: grid; place-items: center; padding: var(--space-8) var(--space-4); }
    .card { width: 100%; max-width: 400px; }
    h1:focus { outline: none; }
    .subtitle { margin: var(--space-2) 0 0; }
    @media (max-width: 839px) {
      :host { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
      .brand { flex-direction: row; padding: var(--space-4); gap: var(--space-4); }
      .mark { width: 32px; height: 32px; font-size: 16px; margin: 0; }
      .wordmark { font-size: 18px; }
      .tag { display: none; }
    }
  `,
})
export class AuthLayout {
  readonly heading = input.required<string>();
  readonly subtitle = input<string | null>(null);
}
