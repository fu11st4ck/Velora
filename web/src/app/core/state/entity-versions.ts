import { Injectable, signal, type Signal } from '@angular/core';

export type Entity = 'products' | 'stock' | 'customers' | 'documents' | 'payments' | 'organization' | 'taxRates' | 'team' | 'sessions';

/**
 * One counter per kind of data. Resources read the counters they depend on, and every successful
 * change bumps the ones it affects, so whatever is on screen fetches again
 * (docs/web-state-management.md §3.2).
 */
@Injectable({ providedIn: 'root' })
export class EntityVersions {
  private readonly counters = new Map<Entity, ReturnType<typeof signal<number>>>();

  of(entity: Entity): Signal<number> {
    return this.counter(entity).asReadonly();
  }

  bump(...entities: Entity[]): void {
    for (const e of entities) this.counter(e).update((n) => n + 1);
  }

  private counter(entity: Entity) {
    let c = this.counters.get(entity);
    if (!c) {
      c = signal(0);
      this.counters.set(entity, c);
    }
    return c;
  }
}
