import { DestroyRef, Directive, ElementRef, inject, input, signal } from '@angular/core';

/**
 * A horizontally scrolling area (a wide table on a phone) that keyboard users can reach and scroll
 * with the arrow keys: focusable and named for screen readers (axe: scrollable-region-focusable) —
 * but only while its content is actually wider than it, so a table that fits adds no tab stop.
 */
@Directive({
  selector: '[appScrollRegion]',
  host: {
    '[attr.tabindex]': "scrollable() ? '0' : null",
    '[attr.role]': "scrollable() ? 'region' : null",
    '[attr.aria-label]': 'scrollable() ? appScrollRegion() : null',
  },
})
export class ScrollRegion {
  readonly appScrollRegion = input.required<string>();
  protected readonly scrollable = signal(false);

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const check = () => this.scrollable.set(el.scrollWidth > el.clientWidth + 1);
    if (typeof ResizeObserver === 'undefined') {
      this.scrollable.set(true); // cannot tell: stay reachable
      return;
    }
    // The box and its content (the table) both change size: when the window resizes, rows load, columns change.
    const observer = new ResizeObserver(check);
    observer.observe(el);
    const content = new MutationObserver(() => {
      for (const child of Array.from(el.children)) observer.observe(child);
      check();
    });
    content.observe(el, { childList: true });
    queueMicrotask(() => {
      for (const child of Array.from(el.children)) observer.observe(child);
      check();
    });
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      content.disconnect();
    });
  }
}
