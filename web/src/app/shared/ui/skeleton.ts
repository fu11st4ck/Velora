import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A placeholder shape while data loads. Hidden from assistive technology; the region carries aria-busy. */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[style.height]': 'height()', '[style.width]': 'width()' },
  template: '',
  styles: `
    :host { display: block; border-radius: var(--radius-sm); background: var(--color-surface-raised); animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.55; } }
    @media (prefers-reduced-motion: reduce) { :host { animation: none; } }
  `,
})
export class Skeleton {
  readonly height = input('16px');
  readonly width = input('100%');
}
