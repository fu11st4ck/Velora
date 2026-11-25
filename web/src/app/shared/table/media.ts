import { DestroyRef, inject, signal, type Signal } from '@angular/core';

/** True while the media query matches. Call in an injection context. */
export function mediaQuery(query: string): Signal<boolean> {
  const list = typeof matchMedia === 'function' ? matchMedia(query) : null;
  const matches = signal(list?.matches ?? false);
  if (list) {
    const listener = (e: MediaQueryListEvent) => matches.set(e.matches);
    list.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => list.removeEventListener('change', listener));
  }
  return matches.asReadonly();
}

/** Phones: lists become cards (docs/web-design-audit.md breakpoints). */
export const COMPACT = '(max-width: 599.98px)';
