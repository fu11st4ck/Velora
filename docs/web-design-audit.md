# Velora Web — Design Audit

**Status:** Sprint W0, 2026-11-25. Desktop and tablet audit of the reference web app (https://velora-sales-inventory.sujankarki15357.chatgpt.site/), complementing the mobile-focused `design-audit.md` and the functional inventory in `product-discovery.md`. Evidence: `reference-screenshots/d*.png` (1440×900), `t01-home.png` (820 wide), `m*.png` (390 wide), captured by `reference-screenshots/audit-script.js` and re-checked today (site still online, unchanged).

The reference is a client-only demo: data lives in one browser, the role is a drop-down ("Viewing as Manager"), figures on the overview are hardcoded. Business behaviour is analysed in `product-discovery.md`; this document is about presentation and interaction on larger screens.

## 1. What the reference contains

| Area | Desktop presentation | Interactions |
|---|---|---|
| Shell | Fixed dark wine sidebar (250 px): diamond "V" logo, VELORA wordmark, five numbered items (01 Overview, 02 Inventory, 03 New sale, 04 Invoices, 05 Reports), footer "Demo data is saved on this device" | Active item: lighter panel and gold left border |
| Top bar (every page) | Gold overline with the company name, large serif page title; right side: avatar + "Viewing as" role select, **+ Add inventory** primary button, **Cart** button with count | Role select switches the whole UI between manager and sales |
| Overview | Hero banner (≈240 px tall) with marketing copy and inventory value; four KPI cards; "Latest sales" list; "Quick actions" list; low-stock warning strip | KPIs are not clickable; quick actions navigate |
| Inventory | Card list with image tile, SKU · weight, name, description, available, purchase cost (manager), action | Search; add inventory modal |
| New sale | Hero banner again; full-width search; product cards with **Set price** | Pricing modal (markup slider, profit), cart drawer |
| Cart → payment | Modal flow: cart lines, customer fields typed in by hand, payment type (Cash, Bank transfer, Credit, Partial) | Creates invoice or quotation document view |
| Invoices | Search, segmented filter (All, Paid, Credit, Partial, Quotation), five-column table, status pills, "View →" | Document view in a modal with print |
| Reports | Four KPI cards, "Sales by team member" bars, "Invoice status" list with counts and shares | None — no period selection |
| Feedback | Dark green toast at bottom right ("INV-… finalized · stock updated") | Auto-dismiss |

## 2. Visual identity worth keeping
- **Palette:** deep wine (`#45151F`, sidebar `#251417`) with antique gold (`#B28A50`) on warm paper (`#FBFAF8`) — distinctive and appropriate for fine jewellery. Already captured as tokens in `design-system.md`; the web app reuses the same values.
- **Serif display + clean sans:** a Didone-style serif for page titles and large figures, a neutral sans for everything else. Keep, but limit the serif to titles and KPI figures (§3).
- **Gold letter-spaced overlines** ("BUSINESS AT A GLANCE", section eyebrows) give hierarchy cheaply. Keep, sparingly.
- **Soft cards with hairline borders**, generous radius, low shadow. Keep.
- **Status pills** with tinted backgrounds. Keep, with stronger text contrast and an icon or label that does not rely on colour.

## 3. Problems on larger screens, and what the web app does instead

| # | Observed (reference) | Why it matters | Web app |
|---|---|---|---|
| 1 | Hero banners take ~240 px at the top of Overview and New sale, with marketing copy | On a 900 px tall laptop screen a third of the first view is decoration; the cashier's working area starts below the fold | No hero banners. Page header is one row: title, context line, primary action. The space goes to data |
| 2 | "+ Add inventory" and "Cart" sit in the top bar of every page | Global buttons unrelated to the current task; the cart is a sales concept shown on the reports page | Page-specific primary actions in the page header. The sale in progress has its own workspace; a small "Sale in progress (3)" chip in the top bar appears only when a cart exists |
| 3 | Role switcher in the top bar | Demo device; in a real product the role comes from sign-in | Account menu: name, role, organization, devices, appearance, sign out |
| 4 | Sidebar keeps 250 px at 820 px width (30% of a tablet), and its dark background ends before the page does on long pages | Tablet content gets cramped (titles wrap to three lines, `INV-2026-00125` breaks across lines); visible layout bug | Sidebar 248 px ≥ 1280 px; icon rail 72 px from 840 to 1279 px (expandable); drawer below 840 px. Sidebar is full viewport height and sticky |
| 5 | Numbered nav items (01–05) | Reads as a slide deck, not an application; numbers carry no meaning | Icons + labels, grouped (Operations, Records, Admin) |
| 6 | Product list as large cards (≈95 px each) on desktop | Five products fill the screen; with 300 products the list is unusable without sort or filter | Desktop: dense table with server-side search, stock filters with counts, sorting, column choice; cards only below 840 px |
| 7 | Invoices table has no paging, sorting, date filter or salesperson filter | Fine for 5 demo rows, not for a year of invoices | Server-paginated table, status and type filters, date range, salesperson (managers), search |
| 8 | Reports have no period selection | All-time totals only; cannot answer "how was this month?" | Range presets (Today, 7 days, This month, Last month, Custom), outstanding labelled "as of now" |
| 9 | Sale flow is a stack of modals (pricing → cart drawer → payment modal → document) | Context is lost at each step; Escape or a misclick discards work; no space to review | Desktop **sale workspace**: product search on the left, live cart and server totals on the right, payment as a final review panel. On phones: steps with a sticky cart bar |
| 10 | Customer details typed into the payment modal each time | Duplicates customers, no history, no balances | Customer picker with search by name, company or phone; create inline; customer pages with history |
| 11 | KPI cards are not interactive | Natural next question ("which invoices are outstanding?") needs navigation | KPI cards and attention rows link to the filtered list |
| 12 | Muted text on cream (`#8A8282` on `#F3EFE9`) and gold text on white | Fails WCAG AA for small text | Tokens adjusted in `design-system.md` (muted `#655D5E`, gold text `#7A5A28`) — reused |
| 13 | Toasts are the only feedback, including for errors; no loading or error states exist (data is local) | A real API is slow sometimes and fails sometimes | Skeletons for loading, inline error states with "Try again", toasts only for completed actions |
| 14 | No keyboard affordances; modals do not trap focus | Desktop power users (cashiers) work from the keyboard | Keyboard-complete sale workspace (`/` focuses search, Enter adds, arrow keys move, Ctrl/⌘+Enter takes payment); focus trapped in dialogs and returned after |
| 15 | Document view prints the whole page | Prints controls and sidebar | Print and download use the server PDF (identical to what the customer receives) |
| 16 | No dark theme | Optional, but the mobile app has one | Light and dark from the same tokens; follows the system unless chosen |

## 4. Information density
The reference is tuned for a showcase: large type, lots of whitespace, few items. The web app targets daily office use on 13–15" laptops:
- **Comfortable** density by default (row height 52 px, body 14 px) with a **compact** option for tables (40 px) remembered per browser.
- Page content max width 1440 px; tables may use the full width; forms are single column, max 640 px, with grouped sections.
- Numbers right-aligned, tabular figures, currency code shown once per column header where the table is single-currency (it always is: one currency per organization).

## 5. Responsive approach (not a shrunken desktop)

| Width | Navigation | Lists | Sale | Forms and details |
|---|---|---|---|---|
| ≥ 1280 px | Persistent sidebar 248 px | Tables, multi-column filters | Two panes (search ∣ cart) | Two-column detail (facts ∣ activity) |
| 840–1279 px | Icon rail 72 px, expands as an overlay | Tables with fewer default columns; secondary columns move into a row expansion | Two panes, cart narrower | Single column |
| < 840 px | Top bar + navigation drawer | Card lists (same data, stacked), filters in a bottom sheet | Steps: products → cart → payment, sticky cart bar | Single column, sticky primary action at the bottom |

Touch targets ≥ 44 px under 840 px; hover-only affordances are never the only way to reach an action.
