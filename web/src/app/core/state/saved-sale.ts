/** Where the sale in progress is kept per user (docs/web-state-management.md §5). */
export const SAVED_SALE_PREFIX = 'velora.sale.';

/** Called on an explicit sign-out: a sale in progress must not outlive the person's session on this browser. */
export function clearSavedSales(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(SAVED_SALE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing was saved either.
  }
}
