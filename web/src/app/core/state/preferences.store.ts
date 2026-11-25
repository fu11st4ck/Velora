import { DOCUMENT, effect, inject } from '@angular/core';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';

export type ThemePreference = 'system' | 'light' | 'dark';

interface Preferences {
  theme: ThemePreference;
  sidebarCollapsed: boolean;
}

const KEY = 'velora.preferences';
const defaults: Preferences = { theme: 'system', sidebarCollapsed: false };

/** Per-browser conveniences. Storage may be unavailable (private mode, blocked): defaults then apply. */
function load(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    const value = raw ? (JSON.parse(raw) as Partial<Preferences>) : {};
    return {
      theme: value.theme === 'light' || value.theme === 'dark' ? value.theme : 'system',
      sidebarCollapsed: value.sidebarCollapsed === true,
    };
  } catch {
    return defaults;
  }
}

export const PreferencesStore = signalStore(
  { providedIn: 'root' },
  withState<Preferences>(load),
  withMethods((store) => ({
    setTheme(theme: ThemePreference) {
      patchState(store, { theme });
    },
    toggleSidebar() {
      patchState(store, { sidebarCollapsed: !store.sidebarCollapsed() });
    },
  })),
  withHooks({
    onInit(store, document = inject(DOCUMENT)) {
      effect(() => {
        const theme = store.theme();
        // The stylesheet switches every token with `light-dark()`, driven by color-scheme.
        document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
        document.documentElement.dataset['theme'] = theme;
        try {
          localStorage.setItem(KEY, JSON.stringify({ theme, sidebarCollapsed: store.sidebarCollapsed() }));
        } catch {
          // Not persisted; still applied for this visit.
        }
      });
    },
  }),
);
