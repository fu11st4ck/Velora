import { computed, signal } from '@angular/core';
import { toApiFailure, type ApiFailure } from '../../core/api/api-failure';
import type { Page, PageMeta } from '../../core/api/types';

export type ListStatus = 'loading' | 'ready' | 'loadingMore' | 'error';

/**
 * A server-paginated list with "Load more" (keyset cursors). `load` starts over with a new query;
 * answers to an earlier query that arrive late are ignored. Items are never invented or kept from
 * another query: what is shown is exactly what the server returned for the current one.
 */
export class PagedList<T, M extends PageMeta = PageMeta> {
  readonly items = signal<T[]>([]);
  readonly meta = signal<M | null>(null);
  readonly status = signal<ListStatus>('loading');
  readonly failure = signal<ApiFailure | null>(null);
  /** Set when "Load more" failed; the items already shown stay. */
  readonly moreFailure = signal<ApiFailure | null>(null);
  readonly hasMore = computed(() => this.meta()?.hasMore === true);

  private fetchPage: ((cursor: string | null) => Promise<Page<T, M>>) | null = null;
  private generation = 0;

  async load(fetchPage: (cursor: string | null) => Promise<Page<T, M>>, options: { keepItems?: boolean } = {}): Promise<void> {
    this.fetchPage = fetchPage;
    const generation = ++this.generation;
    if (!options.keepItems) this.items.set([]);
    this.status.set('loading');
    this.failure.set(null);
    this.moreFailure.set(null);
    try {
      const page = await fetchPage(null);
      if (generation !== this.generation) return;
      this.items.set(page.data);
      this.meta.set(page.meta);
      this.status.set('ready');
    } catch (error) {
      if (generation !== this.generation) return;
      this.failure.set(toApiFailure(error));
      this.status.set('error');
    }
  }

  /** Same query again, keeping rows on screen until the new answer arrives (after a change elsewhere). */
  reload(): Promise<void> {
    return this.fetchPage ? this.load(this.fetchPage, { keepItems: true }) : Promise.resolve();
  }

  async more(): Promise<void> {
    const cursor = this.meta()?.nextCursor;
    if (!this.fetchPage || !cursor || this.status() !== 'ready') return;
    const generation = this.generation;
    this.status.set('loadingMore');
    this.moreFailure.set(null);
    try {
      const page = await this.fetchPage(cursor);
      if (generation !== this.generation) return;
      this.items.update((items) => [...items, ...page.data]);
      this.meta.set(page.meta);
    } catch (error) {
      if (generation !== this.generation) return;
      this.moreFailure.set(toApiFailure(error));
    } finally {
      if (generation === this.generation) this.status.set('ready');
    }
  }
}
