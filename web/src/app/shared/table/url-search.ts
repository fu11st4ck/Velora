import { DestroyRef, type Signal, effect, inject, signal, untracked } from '@angular/core';
import type { ParamMap } from '@angular/router';

/**
 * The search box of a list whose filters live in the URL (`?q=`). Typing updates the URL after a
 * short pause; the box follows the URL when it changes otherwise (Back, Forward, a link, "Clear
 * filters"); a pending update is cancelled when the page is left, so it can never navigate away
 * from the page the person moved to. Create it in an injection context (a field initializer).
 */
export class UrlSearch {
  readonly text: Signal<string>;
  private readonly value: ReturnType<typeof signal<string>>;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    params: Signal<ParamMap>,
    private readonly apply: (q: string | null) => void,
    private readonly delayMs = 300,
  ) {
    this.value = signal(params().get('q') ?? '');
    this.text = this.value.asReadonly();
    effect(() => {
      const q = params().get('q') ?? '';
      untracked(() => {
        // Not while the person is typing: their text wins until it is applied.
        if (this.timer === undefined && this.value().trim() !== q) this.value.set(q);
      });
    });
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  /** The person typed: apply after a pause, or at once. */
  input(text: string, now = false): void {
    this.value.set(text);
    this.cancel();
    const go = () => {
      this.timer = undefined;
      this.apply(text.trim() || null);
    };
    if (now) go();
    else this.timer = setTimeout(go, this.delayMs);
  }

  clear(): void {
    this.input('', true);
  }

  /** Forget the typed text without navigating (the caller resets the URL itself). */
  reset(): void {
    this.cancel();
    this.value.set('');
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
