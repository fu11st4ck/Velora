# Velora — Mobile Design System

Material 3, themed. Implemented in `lib/app/theme/` as a `ThemeData` pair (light, dark) plus a `VeloraTokens` `ThemeExtension` for values Material has no slot for (semantic status colours, spacing, money text styles). Widgets read tokens from the theme only — no literal colours, sizes or radii in feature code.

Colour pairs below were chosen for WCAG AA (4.5:1 body text, 3:1 large text and non-text). They are verified by an automated contrast test in Sprint 1, and any pair that fails is corrected there before use.

## 1. Colour

### Brand palette (from the reference)
| Token | Hex | Origin |
|---|---|---|
| wine-900 | `#251417` | reference sidebar |
| wine-800 | `#3D151E` | reference hero |
| **wine-700** | `#45151F` | reference `--wine` — brand primary |
| wine-600 | `#602433` | reference `--wine-2` |
| wine-100 | `#F1E3E6` | new tint |
| **gold-500** | `#B28A50` | reference `--gold` — accent, non-text |
| gold-700 | `#7A5A28` | new — gold for text on light |
| gold-300 | `#D4B27B` | reference highlight — gold on dark |
| gold-100 | `#F6EBD8` | new tint |
| paper | `#FBFAF8` | reference `--paper` |
| cream | `#F3EFE9` | reference `--cream` |
| line | `#E7E0DB` | reference `--line` |
| ink | `#211B1C` | reference `--ink` |
| muted | `#655D5E` | reference `--muted` darkened for contrast |

### Role mapping
| Role | Light | Dark |
|---|---|---|
| primary / onPrimary | wine-700 / `#FFFFFF` | `#E8B4BF` / `#3A0F19` |
| primaryContainer / on | wine-100 / wine-800 | wine-600 / `#FBE3E8` |
| secondary (accent) / on | gold-700 / `#FFFFFF` | gold-300 / `#3A2A0C` |
| secondaryContainer / on | gold-100 / `#4A3510` | `#55401C` / `#F6EBD8` |
| surface (page) | paper | `#171112` |
| surfaceContainer (card) | `#FFFFFF` | `#211819` |
| surfaceContainerHigh (sheet, bar) | cream | `#2B2022` |
| onSurface | ink | `#EDE6E3` |
| onSurfaceVariant (secondary text) | muted | `#B8ACAE` |
| outlineVariant (hairlines) | line | `#3A2E30` |
| outline (input borders) | `#8F8486` | `#8C7F81` |
| error / onError | `#B3261E` / `#FFFFFF` | `#F2B8B5` / `#601410` |

### Semantic status
Always shown as colour **plus** text label (and icon in dense lists).

| Meaning | Used for | Light fg / bg | Dark fg / bg |
|---|---|---|---|
| success | Paid, In stock, synced | `#1F6846` / `#E6F2EB` | `#8FD3AE` / `#173326` |
| warning | Partial, Credit (not due), Low stock, pending sync | `#7F4F12` / `#F8EEDB` | `#E9C083` / `#3B2A0E` |
| danger | Overdue, Out of stock, Cancelled, failed sync | `#A3261F` / `#FBE9E7` | `#F2B8B5` / `#4A1512` |
| neutral | Quotation, Converted, Expired, archived | `#4E5468` / `#ECEEF3` | `#C3C8D8` / `#2A2D38` |

### Data visualisation
Series order: wine-700, gold-500, `#4E5468`, `#1F6846`, `#8C6A7A` (dark theme: `#E8B4BF`, gold-300, `#C3C8D8`, `#8FD3AE`, `#C9A9B6`). Status charts use the semantic colours. Every series is directly labelled with name and value; no chart relies on colour alone. Charts with one or two values are rendered as labelled bars, never pies.

## 2. Typography

Fonts are bundled (no runtime download): **Playfair Display** (titles and large figures — continues the reference serif) and **Inter** (everything else, with tabular figures enabled for all numbers). Both are OFL-licensed.

| Style | Font | Size / line (sp) | Weight | Use |
|---|---|---|---|---|
| displayMoney | Playfair Display | 34 / 40 | 600 | Hero figure (invoice total, payment amount) |
| headline | Playfair Display | 26 / 32 | 600 | Screen titles on large app bars |
| titleLarge | Playfair Display | 20 / 26 | 600 | Section and sheet titles, KPI values |
| titleMedium | Inter | 16 / 22 | 600 | List primary text, card titles |
| bodyLarge | Inter | 16 / 24 | 400 | Form input text, reading text |
| bodyMedium | Inter | 14 / 20 | 400 | Default body, list secondary |
| labelLarge | Inter | 14 / 20 | 600 | Buttons, chips |
| labelMedium | Inter | 12 / 16 | 600 | Status pills, field labels |
| overline | Inter | 12 / 16, +0.8 tracking, caps | 600 | Eyebrows (gold-700) |
| moneyRow | Inter tabular | 16 / 22 | 600 | Amounts in lists and totals |
| caption | Inter | 12 / 16 | 400 | Timestamps, helper text |

Minimum size is 12 sp. Layouts must hold at 200% system text scale: rows grow, text wraps, nothing truncates an amount.

## 3. Spacing, shape, elevation

- **Spacing scale (dp):** 2, 4, 8, 12, 16, 20, 24, 32, 40, 48. Screen gutter 16 (24 on tablets). Card padding 16. Vertical gap between sections 24.
- **Radii (dp):** 8 chips and small tiles · 12 inputs, buttons · 16 cards · 24 bottom sheets (top corners) · full for pills and avatars.
- **Elevation:** surfaces are separated by a 1 dp `outlineVariant` border, not shadow (matches the reference). Shadows only on floating layers: FAB and pinned bars level 2, sheets and dialogs level 3. Dark theme uses surface tint, no shadows.
- **Touch targets:** 48 × 48 dp minimum, 8 dp apart.
- **Motion:** 200 ms standard easing for sheets and route transitions; shared-axis for the sale steps. Reduced-motion setting disables non-essential animation.

## 4. Icons

Material Symbols Rounded, weight 400, 24 dp (20 dp inside chips). Navigation: `home`, `inventory_2`, `point_of_sale`, `receipt_long`, `menu`. Brand: the diamond "V" monogram, used on splash, login, PDF header and as the placeholder tile for products without a photo.

## 5. Components

| Component | Specification |
|---|---|
| **Primary button** | Filled wine-700, label white, 52 dp high, radius 12, full width in forms and pinned bars. Shows an inline spinner and disables while its request is in flight. One per screen. |
| **Secondary button** | Outlined, 52 dp. |
| **Text button** | For low-emphasis actions ("View all"). |
| **Destructive button** | Filled `error`; used only inside confirmation dialogs. |
| **FAB** | Extended, wine-700; "New product" on Inventory (manager). |
| **Text field** | Outlined, radius 12, 56 dp, persistent label above (not a floating placeholder), helper and error text below. Correct keyboard type and autofill hints. |
| **Money field** | Text field with currency prefix, decimal keypad, formats on blur, rejects more decimals than the currency allows, optional max with inline message. |
| **Stepper** | − value + with 48 dp buttons; long-press repeats; ends disable at bounds; the value is tappable for direct entry. |
| **Price slider** | Slider with floor, list-price and ceiling markers, paired with a money field for exact entry. |
| **Dropdown** | Opens a bottom sheet list on phones (menu on tablets). |
| **Search bar** | 48 dp, pill, leading search icon, trailing clear or scan. Debounced 300 ms. |
| **Filter chips** | Single row, horizontally scrollable, with counts where cheap. |
| **Segmented control** | 2–4 exclusive options (payment method, report range). |
| **Card** | White surface, 1 dp border, radius 16. |
| **KPI card** | Overline label, titleLarge value, caption delta or context. Restricted values render a lock icon with "Manager only" — never a fake number. |
| **List row** | 72 dp minimum; leading 56 dp thumbnail or avatar; title + subtitle; trailing amount and status pill. Whole row is the tap target. |
| **Status pill** | labelMedium, semantic fg/bg, radius full, optional 16 dp icon. |
| **Banner** | Inline, full width, semantic colour, icon + text + optional action. Used for offline, pending sync, low-stock summary. |
| **Bottom sheet** | Modal, drag handle, radius 24, max 90% height, scrolls internally with a pinned action row. Used for pricing, pickers, filters. |
| **Dialog** | Confirmation of irreversible actions only. Title states the action; body states the consequence in numbers ("Stock will be restored for 3 items"); buttons are verbs. |
| **Snackbar** | Short confirmations with optional Undo; sits above pinned bars; never used for errors needing action. |
| **Pinned summary bar** | Bottom of sale screens: total on the left, primary action on the right, respects safe area and keyboard. |
| **Navigation bar** | 5 destinations, labels always visible, badge on Sell for cart unit count. Tablet: navigation rail. |
| **App bar** | Small, centre-aligned title on detail screens; large collapsing title on tab roots. |
| **Timeline** | Vertical list for payments and stock movements: icon, description, signed amount or quantity, user, time. |
| **Bar chart** | Horizontal bars with name left and value right. |
| **Stacked status bar** | One bar split by status with a legend table (label, count, amount, share). |

## 6. Standard screen states

Every data screen implements all four through one shared `AsyncValueView` widget:

| State | Presentation |
|---|---|
| Loading | Skeleton placeholders shaped like the content (no full-screen spinner after first paint). Pull-to-refresh keeps existing content visible. |
| Empty | Monogram illustration, one sentence, one action ("No products yet — Add your first product"). Filtered-empty offers "Clear filters". |
| Error | Icon, plain message from the error catalogue, Retry. Cached content stays visible under a banner when available. |
| Offline | Banner "Offline — showing data from 14:05". Actions that need the server are disabled with an explanation on tap. |

## 7. Formatting

- **Money:** formatted with the organization currency and the user's locale via `intl`, always with the currency's decimal places (AED 2,980.95). Negative amounts use a minus sign. Amounts never wrap or truncate.
- **Percent:** up to two decimals, trailing zeros trimmed (30%, 12.5%).
- **Dates:** organization timezone. Relative for the last 48 hours ("Today 14:05"), then `d MMM yyyy`.
- **Quantities:** integers with "pcs" where ambiguous; weight as entered with unit.

## 8. Accessibility

- Semantics labels on every icon button, stepper, slider (value announced as money) and status pill.
- Focus order follows reading order; sheets and dialogs trap focus; Back and Escape dismiss.
- Screen-reader text for amounts reads the currency name.
- Supports text scale to 200%, bold text, reduced motion, high-contrast mode (borders thicken to 2 dp).
- RTL-safe layouts (directional padding and icons) so Arabic can be added without rework; v1 ships English strings through `flutter_localizations` ARB files.
