# Velora Web — Screen Specifications

**Status:** Proposed (Sprint W0). Behaviour and wording follow the mobile app (`mobile-screen-specifications.md`) and business rules (`business-rules.md`); this document defines the web layout and interactions. Every screen has the standard states (loading, empty, no results, error, forbidden) from `web-component-inventory.md` §1.4 unless stated. Roles: **S** sales, **M** manager, **O** owner.

## Screen inventory

| Code | Screen | Route | Roles | Main API | Sprint |
|---|---|---|---|---|---|
| W-A1 | Sign in | `/sign-in` | public | `POST /auth/web/login` (B1), `GET /auth/me` | W1 |
| W-A2 | Forgot password | `/forgot-password` | public | `POST /auth/forgot-password` | W1 |
| W-A3 | Reset / set password (also accepts invitations) | `/reset-password?token=` | public | `POST /auth/reset-password` | W1 (needs B2) |
| W-S1 | App shell: sidebar, top bar, account menu | — | all | `GET /auth/me` | W1 |
| W-S2 | Global search (⌘/Ctrl+K) | overlay | all | `GET /products`, `/customers`, `/documents` (`q`) | W5 |
| W-S3 | Not found · Forbidden · Session expired | `**` | — | — | W1 |
| W-B1 | Dashboard | `/dashboard` | all (S: own figures, no profit/value) | `GET /dashboard/summary` | W2 |
| W-C1 | Products | `/inventory` | all (cost columns M/O) | `GET /products` | W2 |
| W-C2 | Product detail | `/inventory/:id` | all | `GET /products/{id}`, `GET /inventory/movements?productId=` | W2 |
| W-C3 | New / edit product (drawer on desktop) | `/inventory/new`, `/inventory/:id/edit` | M, O | `POST/PATCH /products`, `DELETE` (archive) | W2 |
| W-C4 | Receive stock (dialog) | from W-C1/C2 | M, O | `POST /inventory/receipts` | W2 |
| W-C5 | Adjust stock (dialog) | from W-C1/C2 | M, O | `POST /inventory/adjustments` | W2 |
| W-C6 | Stock history | `/inventory/history` | all (cost M/O) | `GET /inventory/movements` | W2 |
| W-E1 | Customers | `/customers` | all | `GET /customers` | W3 |
| W-E2 | Customer detail with documents | `/customers/:id` | all (S: own figures) | `GET /customers/{id}`, `GET /documents?customerId=` | W3 |
| W-E3 | New / edit customer (drawer) | `/customers/new`, `/customers/:id/edit` | all; archive M/O | `POST/PATCH/DELETE /customers` | W3 |
| W-D1 | Sale workspace | `/sell` | all with `sale.create` | `GET /products?sellable`, `POST /pricing/preview`, `GET /tax-rates` | W3 |
| W-D2 | Price editor (popover/dialog) | in W-D1 | all (cost/profit M/O) | — (values from product) | W3 |
| W-D3 | Customer picker (dialog) | in W-D1 | all | `GET/POST /customers` | W3 |
| W-D4 | Review and payment (panel) | in W-D1 | all | `POST /invoices`, `POST /quotations` | W3 |
| W-F1 | Documents | `/documents` | all (S: own) | `GET /documents` | W4 |
| W-F2 | Invoice detail | `/documents/invoices/:id` | all (S: own; profit M/O) | `GET /invoices/{id}` | W4 |
| W-F3 | Quotation detail | `/documents/quotations/:id` | all (S: own) | `GET /quotations/{id}`, `POST …/cancel` | W4 |
| W-F4 | Record payment (dialog) | in W-F2 | all | `POST /invoices/{id}/payments` | W4 |
| W-F5 | Refund correction (dialog) | in W-F2 | M, O | `POST /invoices/{id}/refunds` | W4 |
| W-F6 | Cancel invoice (dialog) | in W-F2 | M, O | `POST /invoices/{id}/cancel` | W4 |
| W-F7 | Return items | `/documents/invoices/:id/return` | M, O | `POST /invoices/{id}/returns` | W4 |
| W-F8 | Document PDF (view, print, download, share) | in W-F2/F3 | all (S: own) | `GET …/pdf` | W4 |
| W-G1 | Reports | `/reports` | all (sections by role) | `/reports/*` | W5 |
| W-H1 | Business settings | `/settings/business` | M read, O edit | `GET/PATCH /organization` | W5 |
| W-H2 | Tax rates | `/settings/tax-rates` | M read, O edit | `/tax-rates` | W5 |
| W-H3 | Team | `/settings/team` | M read, O edit | `/organization/members` | W5 |
| W-H4 | Change password | `/account/password` | all | `POST /auth/change-password` | W5 |
| W-H5 | Signed-in devices | `/account/devices` | all | `/auth/sessions` | W5 |
| W-H6 | Appearance | account menu | all | — (local) | W1 |

**Not in the inventory** (no backend and no product decision — see `web-api-integration.md` §4): suppliers, purchases, expenses, profit & loss, categories, product images, branches, permissions editor, notifications, payment register.

## Navigation

Sidebar groups (items hidden when the role lacks the permission):
- **Operations:** Dashboard · Sell · Inventory (Products, Stock history)
- **Records:** Documents · Customers · Reports
- **Admin** (M/O): Business settings · Tax rates · Team

Top bar: breadcrumbs · global search · "Sale in progress (n)" chip when a cart exists · account menu. No branch selector (D9), no notifications bell (no backend; attention items live on the dashboard).

## W-A Authentication

**W-A1 Sign in.** Centered card on a wine background panel (desktop: split — brand panel left, form right; `sm`: form only). Email, password (show/hide), Sign in. Errors inline: wrong credentials, account disabled, too many attempts ("Try again in 4 minutes"), offline. Session-expired arrival shows a notice "Your session ended. Sign in again." After sign-in → return URL or dashboard. No "remember me" (the refresh cookie is the session).
**W-A2 Forgot password.** Email → always the same confirmation ("If an account exists, an email is on its way"), as the API never reveals accounts.
**W-A3 Reset / set password.** New password + confirm; rules shown (10+ characters, not common, not containing the email name). Invalid/expired link state with a "Request a new link" action. Success → sign in.

## W-S Shell

Desktop: sidebar 248 px (logo, groups, footer with organization name and environment badge outside production). Rail at 840–1279. Drawer under 840. Content max width 1440. A skip link "Skip to content" is the first focusable element. Page header pattern: title (serif) + context line + actions on the right. Keyboard: ⌘/Ctrl+K search, `g d` dashboard, `g s` sell (documented in a "Keyboard shortcuts" dialog, `?`).

## W-B1 Dashboard
Row 1: four `KpiTile`s — Today's sales (vs yesterday), Outstanding (overdue in danger tone), In stock (units · products), This month's profit (margin) — the last locked for S. Each tile links to its filtered list. Row 2 (M/O): Inventory value at cost. Row 3: two columns — **Needs attention** (out of stock, low stock, overdue invoices — each a link with count) and **Recent documents** (5 rows, "View all"). New organization: zeros, plus "Add your first product" (M/O). Tablet: tiles 2×2. Phone: tiles stacked 2×2 or 1 column at large text.

## W-C Inventory

**W-C1 Products.** `FilterBar`: search (name, SKU, barcode), stock chips with counts (All, In stock, Low, Out), "Show archived" (M/O). Table columns: Product (name + SKU), Barcode (hidden by default), Weight, Available (with status pill), List price, Floor price (hidden by default), Cost (M/O), Markup (M/O, hidden by default), Value at cost (M/O). Server sort on Name, Available, Newest. Row actions (M/O): Receive, Adjust, Edit. Primary action: New product (M/O). `sm`: cards with name, SKU, available, list price.
**W-C2 Product detail.** Header: name, SKU, status pill, actions (Receive, Adjust, Edit, Archive — M/O). Two columns: left — Prices (list, floor, ceiling; cost and markups for M/O), Details (barcode, weight, description, reorder level); right — Stock (on hand, effective reorder level) and Recent movements (10, "View all" → W-C6 filtered). Archive refused while stock > 0 (message from API).
**W-C3 Product form.** ~~Drawer (desktop) / page (`sm`).~~ **As built (W2): a page at every width** — three sections plus the price preview did not fit a drawer at 1024 px without nested scrolling, and a page gives the form its own URL and Back behaviour. Sections: Identity (name, SKU auto if empty, barcode, description, weight + unit), Pricing (cost, default markup, minimum markup — live list/floor/ceiling preview computed by the server on save; the form shows the bounds from organization settings), Stock (opening quantity — create only; reorder level). Edit uses optimistic locking: on `VERSION_CONFLICT`, "Someone else changed this product" with "Reload".
**W-C4 Receive stock.** Quantity, unit cost (prefilled current cost), supplier name (optional), reference note. Shows the new weighted-average cost after confirmation (from the response).
**W-C5 Adjust stock.** Direction (add/remove), quantity, reason (required). Cannot remove more than on hand (validated, then enforced by the API).
**W-C6 Stock history.** Filters: product (autocomplete), type (opening, receipt, sale, cancellation, return, adjustment in/out), date range (business days in the organization's time zone; as built, invoice/return numbers are plain text until W4). Columns: Date, Product, Type, Change (+/−), Balance after, Unit cost (M/O), Reference (invoice/return/receipt link), By. Load more.

## W-D Sell (critical workflow)

**W-D1 Sale workspace — desktop layout (≥ 1280):**
```
┌ Page header: "New sale"  [Converting QT-2026-00012]            [Clear sale] ┐
├──────────────────────────────────────┬──────────────────────────────────────┤
│ Search products (/)                  │ Customer: [Choose customer…]         │
│ ─ results (sellable only) ─          │ Lines                                │
│  Alhambra Gold Bracelet  24 avail.   │  Bracelet  2 × 3,640.00   7,280.00 ✎ │
│  AED 3,640.00                 [Add]  │  ⚠ Only 1 in stock                   │
│  …  (keyboard: ↑↓ Enter)             │ Discount [   ]  Tax [VAT 5% ▾]       │
│                                      │ Notes                                │
│                                      │ Subtotal / Discount / Tax / Total    │
│                                      │  (server preview; skeleton while     │
│                                      │   updating)                          │
│                                      │ [Save quotation]   [Take payment →]  │
└──────────────────────────────────────┴──────────────────────────────────────┘
```
- Adding a product opens the **price editor (W-D2)** prefilled with the list price; Enter accepts. Same product at the same price merges lines.
- Every change triggers a debounced `POST /pricing/preview`; totals and per-line problems (below floor, above ceiling, insufficient stock, unavailable) come from the server and are shown on the line. "Take payment" is disabled until the preview is valid and a customer is chosen; the reason is shown.
- The sale in progress is saved per user in the browser and survives reloads; "Clear sale" asks first.
- 840–1279: same two panes, cart 400 px. `sm`: three steps (Products → Cart → Payment) with a sticky bar "3 items · AED 7,644.00 · Review".

**W-D2 Price editor.** Quantity stepper (max = available), unit price `MoneyInput` with "Lowest AED 3,220.00 · Highest AED 4,480.00", line total. M/O additionally: cost, profit and markup for the entered price, and "Sell below the lowest price" switch requiring a reason (audited). S never sees cost or percentages (D1).
**W-D3 Customer picker.** Search by name, company or phone (digits); results with company and mobile; "New customer" opens the customer form inside the dialog and returns the created customer; existing-number warning ("This number is already saved — use existing?") as on mobile.
**W-D4 Review and payment.** Panel replaces the cart column (desktop) or step 3 (`sm`): customer, lines summary, server totals; amount received now (default full, chips Full / Half / None), method (Cash, Bank transfer + reference), credit days when a balance remains (default from settings) with the due date shown; one outcome sentence ("Partially paid — AED 2,822.00 due 16 Dec 2026"). **Confirm** opens a `ConfirmDialog` summarising total, amount received and stock effect; submission follows the duplicate-protection rules (`web-state-management.md` §6). Success → invoice detail (W-F2) with a toast; refusal → back to the cart with the problems on their lines, nothing saved; no answer → "We could not confirm the sale. Retry" (same key).
**Save quotation** (from the cart): no stock effect; → quotation detail.

## W-E Customers
**W-E1.** Search (name, company, email, phone digits). Columns: Name, Company, Mobile, Email, Created. Sort: Name, Newest. Row → detail. New customer (all roles). Balances per row need B4; until then the column is absent (not faked).
**W-E2.** Header with name/company, actions (Call/WhatsApp/Email links, Edit, Archive M/O, **New sale for this customer** → W-D1 with customer preset). Summary tiles: Invoiced, Outstanding, Overdue (S: own). Documents table filtered by `customerId` (same component as W-F1). Details: mobile, email, address, TRN, notes.
**W-E3.** Name or company required; mobile validated and stored in international form; email; address; TRN; notes. Duplicate-mobile prompt before create.

## W-F Documents
**W-F1.** Filters: type (All, Invoices, Quotations), status chips (Unpaid, Partly paid, Overdue, Paid, Cancelled; quotation statuses when Quotations), date range, salesperson (M/O), search (number, customer, company, mobile). Columns: Number + type, Date, Customer (+ company), Salesperson, Total, Balance (+ due date, red when overdue), Status. Newest first (only order the API supports; B5). Load more.
**W-F2 Invoice detail.** Header: number, status pill, total, balance and due date; actions: Record payment, PDF (view/print/download), WhatsApp link, more: Return items, Cancel, Refund (M/O). Body two columns: left — Bill to, Lines (qty, price, line total; M/O: cost and markup per line, profit card), Totals; right — Payments timeline (payments and refunds with method, reference, who, when), Returns (credit notes), Activity (created by, from quotation, cancelled reason).
**W-F3 Quotation detail.** Number, status (Open, Converted with invoice link, Expired, Cancelled), valid until, lines, totals; actions: Convert to sale (loads the sale workspace; asks before replacing a cart in progress), PDF, Cancel.
**W-F4 Record payment.** Amount (default = balance, capped), method, reference; outcome sentence; idempotent submit.
**W-F5 Refund (correction).** Amount (≤ paid), method, reason; for money returned by mistake — distinct from a return of goods. M/O.
**W-F6 Cancel invoice.** Reason (required); refund method when money was received; consequences spelled out (stock restored for n items; AED x recorded as refunded). Refused when returns exist (message from API).
**W-F7 Return items.** Per line: returnable quantity stepper, restock switch (damaged → not restocked); reason; computed credit and refund come from the API response — the page states the rule ("credit reduces the balance first; anything above is refunded") and asks for the refund method only when the API says a refund is due (two-step like mobile).
**W-F8 PDF.** View in a dialog (browser PDF viewer in an `<iframe>` from a blob URL), Print (opens the PDF and calls print), Download (`INV-2026-00007.pdf`). WhatsApp: `https://wa.me/<digits>?text=…` link; the PDF itself is downloaded/attached by the user (no API to send).

## W-G1 Reports
Range presets (Today, 7 days, This month, Last month, Custom ≤ 366 days) in the URL. Sections: Net sales (hero figure, invoice count), Sales (invoiced, tax, discounts, returns, money received), Profit (M/O: COGS, gross profit, margin), Owed now (outstanding, overdue — labelled "as of today"), Invoice status (`StackedStatusBar` + legend: count, amount, share; overdue line), Sales by team member (M/O: `BarList` with invoice count and profit), Stock (M/O: value at cost, units, top 5 by value). Export (M/O): Sales CSV for the period, Stock CSV. S sees own figures and none of the M/O sections.

## W-H Settings and account
**W-H1 Business settings.** Sections as cards: Company (name, legal name, TRN, phone, email, address, city, country, invoice footer), Regional (currency, time zone — locked with explanation once documents exist), Sales rules (max markup, default markup, default minimum markup, credit days, quotation validity, low-stock level). Only changed fields are sent; saving refreshes the session profile. M: read-only with a notice.
**W-H2 Tax rates.** Table: name, rate, default, status; add (rate immutable afterwards), rename, make default, stop using / use again. Exactly one default (enforced by API).
**W-H3 Team.** Table: name (you), email, role, status (Invited, No access); invite (name, email, role Sales/Manager); change role; remove/restore access (confirmation; signs them out at once). Invitation result states whether the email was sent.
**W-H4 Change password.** Current, new, confirm; signs other devices out.
**W-H5 Devices.** Sessions with device name, last used, signed in; "This device"; sign out others individually.
**W-H6 Appearance.** System / Light / Dark in the account menu; applied instantly, remembered per browser.
