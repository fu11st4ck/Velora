import { Directive, input } from '@angular/core';

/**
 * A horizontally scrolling area (a wide table on a phone) that keyboard users can reach and scroll
 * with the arrow keys: focusable, and named for screen readers (axe: scrollable-region-focusable).
 */
@Directive({
  selector: '[appScrollRegion]',
  host: { tabindex: '0', role: 'region', '[attr.aria-label]': 'appScrollRegion()' },
})
export class ScrollRegion {
  readonly appScrollRegion = input.required<string>();
}
