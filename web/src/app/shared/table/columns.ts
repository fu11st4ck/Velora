import { computed, signal } from '@angular/core';

export interface ColumnDef {
  id: string;
  label: string;
  /** Shown unless the person hides it. */
  visibleByDefault: boolean;
  /** Cannot be hidden (the identifying column). */
  fixed?: boolean;
}

/**
 * Which optional columns a table shows. The choice is a per-browser convenience kept in
 * localStorage (try/catch: storage may be unavailable); available columns depend on the role.
 */
export class ColumnChoice {
  private readonly hidden: ReturnType<typeof signal<Set<string>>>;
  private readonly shownExtra: ReturnType<typeof signal<Set<string>>>;

  constructor(
    private readonly key: string,
    readonly all: () => ColumnDef[],
  ) {
    const saved = ColumnChoice.read(key);
    this.hidden = signal(new Set(saved.hidden));
    this.shownExtra = signal(new Set(saved.shown));
  }

  readonly visible = computed(() =>
    this.all()
      .filter((c) => c.fixed || (c.visibleByDefault ? !this.hidden().has(c.id) : this.shownExtra().has(c.id)))
      .map((c) => c.id),
  );

  isVisible(id: string): boolean {
    return this.visible().includes(id);
  }

  toggle(column: ColumnDef): void {
    if (column.fixed) return;
    const target = column.visibleByDefault ? this.hidden : this.shownExtra;
    target.update((set) => {
      const next = new Set(set);
      if (next.has(column.id)) next.delete(column.id);
      else next.add(column.id);
      return next;
    });
    try {
      localStorage.setItem(this.key, JSON.stringify({ hidden: [...this.hidden()], shown: [...this.shownExtra()] }));
    } catch {
      // Kept for this visit only.
    }
  }

  private static read(key: string): { hidden: string[]; shown: string[] } {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? '{}') as { hidden?: unknown; shown?: unknown };
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
      return { hidden: strings(value.hidden), shown: strings(value.shown) };
    } catch {
      return { hidden: [], shown: [] };
    }
  }
}
