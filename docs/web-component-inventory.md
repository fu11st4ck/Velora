# Velora Web — Design System and Component Inventory

**Status:** Proposed (Sprint W0). Visual foundations are shared with the mobile app (`design-system.md`): the same colour values, type families and semantic meanings. This document defines how they are applied on the web and lists every reusable component, with what it is built on. One component per job — no near-duplicates.

## 1. Foundations

### 1.1 Tokens
Defined once as CSS custom properties in `web/src/styles/tokens.css`, with a dark-theme block (`[data-theme=dark]` and `prefers-color-scheme` when the preference is "system"). Angular Material 3 is themed from the same properties, so Material components and custom ones match.

| Group | Tokens (light value → dark value) |
|---|---|
| Brand | `--brand-wine-900 #251417`, `--brand-wine-700 #45151F`, `--brand-wine-600 #602433`, `--brand-wine-100 #F1E3E6`, `--brand-gold-500 #B28A50`, `--brand-gold-700 #7A5A28`, `--brand-gold-300 #D4B27B`, `--brand-gold-100 #F6EBD8` |
| Roles | `--color-primary` wine-700 → `#E8B4BF`; `--color-on-primary` `#FFF` → `#3A0F19`; `--color-accent` gold-700 → gold-300; `--color-page` `#FBFAF8` → `#171112`; `--color-surface` `#FFF` → `#211819`; `--color-surface-raised` `#F3EFE9` → `#2B2022`; `--color-text` `#211B1C` → `#EDE6E3`; `--color-text-muted` `#655D5E` → `#B8ACAE`; `--color-line` `#E7E0DB` → `#3A2E30`; `--color-border-input` `#8F8486` → `#8C7F81`; `--color-focus` gold-500 (3 px ring, 2 px offset) |
| Sidebar | `--sidebar-bg` wine-900 (both themes), `--sidebar-text` `#E9E1DE`, `--sidebar-active-bg` `rgba(255,255,255,.08)`, `--sidebar-active-marker` gold-300 |
| Status | success `#1F6846`/`#E6F2EB` (dark `#8FD3AE`/`#173326`); warning `#7F4F12`/`#F8EEDB`; danger `#A3261F`/`#FBE9E7`; neutral `#4E5468`/`#ECEEF3` — foreground/background pairs, all ≥ 4.5:1 |
| Data viz | series: wine-700, gold-500, `#4E5468`, `#1F6846`, `#8C6A7A` (dark: `#E8B4BF`, gold-300, `#C3C8D8`, `#8FD3AE`, `#C9A9B6`) |
| Spacing | 4 px grid: `--space-1` 4 … `--space-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-12` 48 |
| Radius | `--radius-sm` 8 (inputs, pills), `--radius-md` 12 (cards, dialogs), `--radius-lg` 16 (sheets), `--radius-full` |
| Elevation | `--shadow-1` `0 1px 2px rgba(33,27,28,.06)` (cards), `--shadow-2` `0 4px 16px rgba(33,27,28,.10)` (menus, popovers), `--shadow-3` `0 12px 40px rgba(33,27,28,.18)` (dialogs). Dark theme: borders instead of shadows for levels 1–2 |
| Motion | 150 ms standard, 250 ms for panels; `prefers-reduced-motion` turns transitions into fades or none |
| Breakpoints | `sm` < 840 · `md` 840–1279 · `lg` ≥ 1280 · `xl` ≥ 1600 |

### 1.2 Typography
Self-hosted woff2 files (no third-party font requests; required by the CSP): **Playfair Display** (display) and **Inter** (UI), both OFL — the same families as the mobile app.

| Style | Font | Size / line | Use |
|---|---|---|---|
| display | Playfair Display 500 | 32/40 | Page title on dashboard only |
| title-lg | Playfair Display 500 | 24/32 | Page titles |
| title-md | Inter 600 | 18/26 | Card and dialog titles |
| title-sm | Inter 600 | 15/22 | Section headers, table group headers |
| body | Inter 400 | 14/22 | Default |
| body-sm | Inter 400 | 13/20 | Secondary lines, table meta |
| label | Inter 500 | 13/18 | Form labels, buttons (14 for buttons) |
| overline | Inter 600, 0.12em tracking, uppercase | 11/16 | Section eyebrows, KPI labels — gold-700 / gold-300 |
| money-lg | Playfair Display 500, tabular | 28/36 | KPI and document totals |
| money | Inter 600, tabular | 14/22 | Amounts in tables and totals rows |

Minimum text size 12 px. All amounts use `font-variant-numeric: tabular-nums` and are right-aligned in tables.

### 1.3 Icons
Material Symbols Rounded, self-hosted subset (≈60 glyphs), 20 px in tables and inputs, 24 px in navigation. Every icon-only button has an accessible name and a tooltip.

### 1.4 States every data screen has
Loading (skeleton matching the final layout, shown after 150 ms) · Empty (icon, one sentence, one action if the role can act) · No results for the filters (with "Clear filters") · Error (what failed, "Try again", request reference for server errors) · Forbidden ("You don't have access to this") · Not found.

## 2. Components

Base: **M** = Angular Material 3 component, themed; **C** = Angular CDK primitive; **own** = written here. "Replaces" lists what must not be built separately.

### Layout and navigation
| Component | Base | Purpose / API |
|---|---|---|
| `AppShell` | own + C (`BreakpointObserver`) | Sidebar / rail / drawer by breakpoint, top bar, content outlet, skip link |
| `SidebarNav` | own + M (`mat-nav-list`) | Groups and items from a typed config with `permission`; badges |
| `TopBar` | own | Breadcrumbs, global search trigger, sale-in-progress chip, account menu |
| `Breadcrumbs` | own | From route `data.breadcrumb` (string or resolver) |
| `AccountMenu` | M (`mat-menu`) | Name, role, organization, change password, devices, appearance (system/light/dark), sign out |
| `GlobalSearch` | own + C (`Overlay`) | ⌘/Ctrl+K; queries products, customers, documents in parallel (existing endpoints), grouped results, keyboard navigation |
| `PageHeader` | own | Title, subtitle/context line, primary and secondary actions slot |
| `Tabs` | M (`mat-tab-nav-bar` bound to routes; `mat-tab-group` for in-page) | — |

### Actions and inputs
| Component | Base | Notes |
|---|---|---|
| Button | M (`matButton` variants: filled, tonal, outlined, text; `matIconButton`) | Variants mapped to tokens; `busy` state via a `[veloraBusy]` directive (spinner + disabled + `aria-busy`). Replaces any custom button |
| `FormField` helpers | M (`mat-form-field`, outlined) | Labels always visible; error text under the field; required marked in the label |
| `SearchField` | M form field + own debounce | Debounced 300 ms, clear button, `/` shortcut where it is the page's main search |
| Select / Autocomplete | M (`mat-select`, `mat-autocomplete`) | — |
| `MoneyInput` | own `ControlValueAccessor` on a text input | Value is integer minor units; parsing in `core/money`; shows currency code; no floats anywhere |
| `PercentInput` | own CVA | Value in basis points |
| `QuantityStepper` | own | − / input / +, min/max, keyboard arrows |
| Date picker / range | M (`mat-datepicker`, `mat-date-range-picker`) | Calendar dates in the organization's time zone; presets in Reports |
| Segmented filter | M (`mat-chip-listbox`, single select) | Status filters with counts when the API gives them |
| Switch, checkbox, radio | M | — |

### Data display
| Component | Base | Notes |
|---|---|---|
| `DataTable` | M (`mat-table`) + C | Typed column definitions (`key`, `header`, `cell` template, `align`, `sortable` → server sort key, `hideBelow`, `priority`); server sort only where the API supports it; sticky header; row click → detail; column visibility menu (remembered); **card mode** below 840 px using the same column defs; "Load more" with cursor; skeleton rows; empty/error slots. Replaces any ad-hoc table or list **As built (W2):** not one generic component yet — pages use `mat-table` with the shared pieces `PagedList` (cursor paging), `LoadMore`, `ColumnChoice` (remembered columns) and `mediaQuery` (cards below 600 px). A single `DataTable` will be extracted if W3–W4 tables repeat the same template |
| `FilterBar` | own | Search + filter chips + date range + "Clear"; writes to URL; on `sm` collapses into a bottom sheet |
| `StatusPill` | own | `tone` (success/warning/danger/neutral) + label (+ optional icon); one source for invoice, quotation, stock statuses |
| `MoneyPipe` / `money` | own pipe | Formats minor units with the organization currency; `sign` and `withCode` options |
| `KpiTile` | own | Overline label, value, secondary lines, optional alert line, optional link; locked state for withheld figures |
| `FactList` | own | Label/value rows (detail screens, totals), money rows right-aligned |
| `Card`, `SectionCard` | M (`mat-card`, outlined) | Title, actions slot |
| `EmptyState`, `ErrorState`, `ForbiddenState` | own | One component with variants; used by `DataTable` and pages |
| `Skeleton` | own | Line, block, table-row shapes |
| `BarList` | own (CSS) | Labelled horizontal bars — sales by team member; values always printed |
| `StackedStatusBar` | own (SVG/CSS) | Paid/partial/unpaid shares with a legend table (counts, amounts, shares) |
| `Avatar` | own | Initials |

### Overlays and feedback
| Component | Base | Notes |
|---|---|---|
| `Dialog` | M (`MatDialog`) | Standard sizes (sm 400, md 560, lg 800); full-screen below 840 px |
| `ConfirmDialog` | on `Dialog` | Title, consequence text, confirm label, `danger` tone; optional typed confirmation for destructive actions; returns `boolean` |
| `Drawer` | M (`mat-sidenav` end) / C overlay | Side panel for create/edit forms on desktop (product, customer) — becomes a page on `sm` |
| `Toast` | M (`MatSnackBar`) wrapper `notify.success/info/error()` | One at a time, 4 s (10 s with action), polite live region |
| `Menu`, `Tooltip` | M | — |

### Domain components (shared by more than one feature)
| Component | Used by |
|---|---|
| `CustomerPicker` (dialog: search by name/company/phone, create inline) | Sell, documents filters |
| `ProductSearchList` (keyboard-navigable results with availability and list price) | Sell, global search |
| `PriceEditor` (price within floor–ceiling; managers: cost, profit and below-floor reason) | Sell |
| `DocumentTotals` (subtotal, discount, tax, total, paid, balance) | Sell review, invoice and quotation detail |
| `PaymentForm` (amount, method, reference, credit days; outcome sentence) | Sell, record payment |
| `DocumentActions` (view PDF, download, print, WhatsApp link, cancel, return) | Invoice and quotation detail |

## 3. Rules
- New component only when no existing one fits by configuration; otherwise extend the existing one.
- Presentational components: inputs/outputs only, `OnPush`, no services except formatting.
- Every component has a Vitest component test and appears in a "design system" route available in development builds only (`/dev/ui`), used for visual review and Playwright screenshots.
