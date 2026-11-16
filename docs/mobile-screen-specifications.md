# Velora — Mobile Screen Specifications

Each screen lists route, access, layout, components, actions, navigation, states and tablet behaviour. Component names refer to [`design-system.md`](design-system.md); endpoints to [`api-specification.md`](api-specification.md). All data screens implement the four standard states (loading, empty, error, offline) — only screen-specific details are repeated here.

**Roles:** O = Owner, M = Manager, S = Sales. "M" implies Owner too.
**Tablet (≥ 840 dp):** navigation rail replaces the bottom bar; noted per screen when the layout changes further.

## Shell

| | |
|---|---|
| Bottom navigation | Home `/home` · Inventory `/inventory` · Sell `/sell` (badge = cart units) · Documents `/documents` · More `/more` |
| Back behaviour | Each tab keeps its own stack (`StatefulShellRoute`). Back on a tab root goes to Home, then exits. |
| Global banners | Offline; "N changes waiting to sync" (opens Sync queue); "Session expired". |

---

## A. Authentication

### A1 Login — `/login` (public)
- **Layout:** monogram and wordmark; email field; password field with show/hide; primary "Sign in"; text button "Forgot password?".
- **Validation:** email format, password non-empty, on submit. Server errors inline: wrong credentials (generic), account disabled, too many attempts (shows wait time).
- **Navigation:** success → `/home` (or the deep link that triggered login). One organization per user in v1; if the API returns several memberships, an organization picker sheet appears.
- **Tablet:** form in a 420 dp centred card.

### A2 Forgot password — `/forgot-password`; A3 Reset password — `/reset-password?token=`
- A2: email → always shows "If that address exists, a reset link is on its way."
- A3 (opened from the emailed deep link): new password + confirm, strength rules listed and ticked live → success → Login.

---

## B. Home

### B1 Home — `/home` (all roles)
- **App bar:** large title "Velora", subtitle "<Organization> · <greeting by local time>, <first name>"; trailing sync status icon.
- **Body (scroll, pull to refresh):**
  1. **KPI grid 2×2:** Today's sales (delta vs yesterday) · Outstanding (count; overdue amount in danger colour) · In stock (units; product count) · This month's profit (margin %) — the last, and Inventory value below, show a lock for S.
  2. **Inventory value card** (M): value at cost.
  3. **Needs attention:** rows "N products low or out of stock" → Inventory filtered `low`; "N invoices overdue · amount" → Documents filtered `overdue`. Hidden when both are zero.
  4. **Recent documents:** last 5 (S: own) as document rows; "View all" → Documents.
- **Data:** `GET /dashboard/summary`.
- **Empty (new organization):** KPIs show zero; checklist card "Add your first product" (M).
- **Tablet:** KPIs in one row of four; attention and recent side by side.

---

## C. Inventory

### C1 Inventory list — `/inventory` (all roles)
- **App bar:** large title "Inventory"; action: sort menu (Name, Stock low→high, Recently added).
- **Sticky header:** search bar (name, SKU, barcode; trailing scan icon) and filter chips All · In stock · Low · Out, each with a count.
- **Row (≥ 72 dp):** 56 dp photo or monogram tile; name; "SKU · weight"; trailing quantity with stock pill; price line: M → "Cost AED 2,800.00", S → "From AED 3,640.00".
- **Actions:** tap → C2; FAB "New product" (M) → C3; pull to refresh; infinite scroll (25 per page).
- **Data:** `GET /products?q&stockStatus&sort&cursor`.
- **Empty:** no products → M: "Add your first product"; S: "No products yet". Filtered → "No products match" + Clear filters.
- **Tablet:** list (360 dp) + detail pane.

### C2 Product detail — `/inventory/:productId`
- **Header:** photo (tap to view full-screen), name, SKU, barcode, weight, description, stock pill.
- **Stock card:** on-hand quantity (per branch if more than one), reorder level.
- **Pricing card:** M → cost, default markup %, minimum markup %, list price, floor price. S → list price and floor price only.
- **Recent movements:** last 5 timeline rows; "View all" → C6.
- **Bottom bar:** primary "Sell" (opens D2 price sheet; disabled at zero stock). M overflow/secondary: Receive stock → C4, Adjust stock → C5, Edit → C3, Archive (confirmation dialog; blocked with an explanation if stock > 0).
- **Data:** `GET /products/:id`, `GET /inventory/movements?productId&limit=5`.

### C3 New / Edit product — `/inventory/new`, `/inventory/:productId/edit` (M)
- **Sections:**
  1. Photo (camera or gallery; cropped square; uploaded on save).
  2. Details: Name*; SKU (blank = auto-generated, shown after save); Barcode (scan button); Description; Weight + unit (g / kg), optional.
  3. Pricing: Cost per item* (new only — afterwards cost changes only through receipts); Default markup %*; Minimum markup %*; live "List price" and "Floor price".
  4. Stock (new only): Opening quantity* (≥ 0); Reorder level (blank = organization default, shown as hint).
- **Validation:** name required ≤ 120; SKU unique (server; inline error on the field); 0 ≤ minimum ≤ default ≤ organization maximum; cost ≥ 0; integer quantities.
- **Pinned bar:** "Total purchase value AED …" (new, quantity × cost) and primary "Save product".
- **Leaving with unsaved changes:** discard confirmation.
- **Data:** `POST /products`, `PATCH /products/:id` (with `version`; a 409 version conflict offers reload), image via `POST /products/:id/image-upload-url`.
- **Requires connection.**

### C4 Receive stock — `/inventory/:productId/receive` (M)
- **Fields:** Quantity received* (≥ 1); Cost per item* (prefilled with current cost); Supplier name; Reference / note.
- **Live summary:** total purchase value; "New stock: 24 → 34"; "New average cost: AED 2,800.00 → AED 2,829.41".
- **Action:** "Receive stock" → `POST /inventory/receipts` (idempotent) → back to C2 with snackbar.

### C5 Adjust stock — `/inventory/:productId/adjust` (M)
- **Fields:** direction segmented (Remove / Add); Quantity* (Remove capped at on-hand); Reason* (chips: Count correction, Damaged, Lost, Other + free text when Other).
- **Summary:** "Stock: 24 → 22". Confirmation dialog before submitting.
- **Data:** `POST /inventory/adjustments` (idempotent).

### C6 Stock history — `/inventory/:productId/movements` (M; S sees quantities without costs)
- **List:** timeline rows — type label, signed quantity, balance after, linked document number (tap → F2), user, time; M also sees unit cost.
- **Filter chips:** All · Receipts · Sales · Returns · Adjustments. Cursor-paginated.

---

## D. Sell

> **As built (Sprint 4):** D1–D5 and F1–F6 are implemented. Differences: no Drafts action or D6 screen (one cart in progress is kept on the device); the customer picker is a sheet, not a route; D1 lists the first 50 matches and asks the user to search for more; tax is chosen with chips on the cart; F1 has status chips and search but no date/salesperson filter sheet; printing goes through the system share sheet; offline invoicing is not available yet.

### D1 Sell — `/sell` (all roles)
- **App bar:** title "New sale"; action "Drafts" when saved drafts exist.
- **Header:** search bar with scan icon.
- **List:** sellable products (active, quantity > 0) as compact rows with available quantity and list price; a quantity badge marks products already in the cart.
- **Tap / successful scan:** opens D2.
- **Pinned summary bar (when cart non-empty):** "3 items · AED 12,480.00" + primary "Review cart" → D3.
- **Empty cart, no products in stock:** message and (M) link to Inventory.
- **Tablet:** product list left, live cart (D3 content) right.

### D2 Price sheet — bottom sheet
- **Header:** thumbnail, name, SKU · weight, "N available" (stock minus quantity of this product already in the cart).
- **Manager view:** Cost; Markup % slider (minimum … organization maximum, 0.5 steps) with numeric entry; Profit per item; Selling price (editable — editing price back-computes markup). "Sell below minimum" switch reveals a reason field and lowers the bound to 0%.
- **Sales view:** Selling price slider from floor to ceiling with a list-price marker and an exact-entry money field. No cost, no percentages.
- **Quantity:** stepper 1 … available.
- **Footer:** Line total; primary "Add to cart" / "Update" when editing a line.
- **Rules:** price is rounded to the currency's minor unit; out-of-range values are clamped with an inline note ("Lowest allowed price is AED 3,220.00").

### D3 Cart — `/sell/cart`
- **Customer row:** "Add customer" → D4; once chosen shows name, company, mobile with Change.
- **Lines:** name, SKU, "2 × AED 3,640.00", line total; M also sees markup %. Tap → D2 in edit mode; swipe to remove with Undo snackbar. Lines for the same product at different prices are allowed; the combined quantity is capped at stock.
- **Adjustments:** Discount money field (0 … subtotal); Tax rate dropdown (active organization rates; default preselected); Notes (optional, printed on the document).
- **Totals card:** Subtotal, Discount, Tax (name and rate), **Total** — values from `POST /pricing/preview` (local calculation shown while loading or offline, marked "estimated" offline).
- **Pinned bar:** secondary "Save quotation", primary "Take payment" → D5. Both disabled until there is a customer and at least one line; tapping a disabled button scrolls to and highlights what is missing.
- **Overflow:** Save as draft; Clear cart (confirmation).
- **Persistence:** the cart (lines, customer, adjustments) is saved locally on every change and restored on launch.

### D4 Customer picker — `/sell/cart/customer` (full-screen sheet)
- **Search** by name, company or mobile (local cache first, then server). Recent customers listed by default.
- **Row:** name / company, mobile. Tap selects and returns.
- **"New customer"** → E3 form inline; on save the customer is selected. A matching mobile number prompts "Use existing customer <name>?".

### D5 Payment — `/sell/payment`
- **Header:** displayMoney total.
- **Amount received now:** money field, default = total, capped at total; chips Full · Half · None.
- **Method** (amount > 0): segmented Cash · Bank transfer; Bank transfer shows Reference field.
- **Balance terms** (amount < total): "Balance AED … due in" days field (default from settings) with computed due date and a date picker.
- **Outcome line:** "Invoice will be marked **Paid**" / "**Partially paid** — AED … due 15 Dec 2026" / "**Credit** — AED … due 15 Dec 2026".
- **Primary:** "Create invoice" → confirmation dialog summarising customer, total, received, and "Stock will be reduced for N items" → `POST /invoices` with idempotency key.
- **Success:** cart cleared; navigates to F2 for the new invoice with a success banner and Share prominent.
- **Insufficient stock (409):** returns to D3 with affected lines flagged "Only 2 available" and quantities left for the user to correct.
- **Offline:** if offline invoicing is disabled → explanatory sheet, offers Save as draft or Save quotation. If enabled → creates a provisional invoice (see H2).

### D6 Drafts — `/sell/drafts`
- Locally saved carts: customer, item count, total, last edited. Tap to resume (replaces the current cart after confirmation); swipe to delete.

---

## E. Customers (under More)

### E1 Customers — `/more/customers` (all roles)
- Search; rows with name, company and mobile. FAB "New customer". Cursor-paginated. Balances are shown on the detail screen (E2), not in the list.

### E2 Customer detail — `/more/customers/:customerId`
- **Header:** name, company, mobile (tap to call / WhatsApp), email, address, TRN.
- **Summary:** total invoiced, outstanding, overdue (S: computed over own documents only).
- **Documents list** for this customer (S: own).
- **Actions:** New sale for this customer (pre-selects in cart); Edit → E3; Archive (M).

### E3 New / Edit customer — `/more/customers/new`, `/:customerId/edit`
- **Fields:** Name; Company (at least one of the two required); Mobile (country picker defaulting to the organization country, stored E.164); Email; Address; Tax registration number; Notes.
- **Validation:** email and phone formats; duplicate mobile warning with link to the existing record.

---

## F. Documents

### F1 Documents — `/documents` (all roles; S sees own)
- **App bar:** large title "Documents"; filter action (badge when active).
- **Header:** search (number, customer, company, mobile); chips All · Unpaid · Partial · Paid · Overdue · Quotations · Cancelled.
- **Filter sheet:** type, date range presets and custom, salesperson (M).
- **Row:** number + status pill; customer; date · salesperson (M); trailing total; when a balance remains: "Balance AED … · due 15 Dec" (danger colour if overdue).
- **Data:** `GET /documents`. Pull to refresh; infinite scroll.
- **Tablet:** list + detail pane.

### F2 Document detail — `/documents/invoices/:id`, `/documents/quotations/:id`
- **Header card:** type and number; status pill(s) (payment status, Overdue, Cancelled; quotation status); displayMoney total; invoice: Paid / Balance / Due date.
- **Customer card:** bill-to details → E2.
- **Items:** name, SKU, qty × unit price, line total; returned quantity if any. M: expandable "Profit" section (cost, gross profit, margin). Never shown to S.
- **Totals:** subtotal, discount, tax, total; credited (returns); paid; balance.
- **Payments timeline** (invoice): each payment or refund with method, reference, user, time.
- **Meta:** salesperson, issued at, source quotation link, notes, cancellation reason.
- **Bottom bar — invoice:** primary "Record payment" (when balance > 0) → F3; "Share" → F6; overflow (M): Return items → F5, Cancel invoice → F4.
- **Bottom bar — quotation:** primary "Convert to invoice" (OPEN only) → loads lines into the cart and opens D3 with a notice if prices or stock changed; "Share"; overflow: Cancel quotation.
- **Pending-sync documents** show a "Waiting to sync" banner and have no number, share or payment actions until confirmed.

### F3 Record payment — sheet from F2
- Amount (default = balance, capped at balance), method, reference, date received (default now, not in the future), note. Outcome line. `POST /invoices/:id/payments` (idempotent). Works offline as a queued operation.

### F4 Cancel invoice — dialog flow (M)
- Reason* → confirmation stating "AED … received will be recorded as refunded (method selector)" and "Stock restored for N items". `POST /invoices/:id/cancel`. Blocked if the invoice has returns (explains to use the remaining return instead). Requires connection.

### F5 Return items — `/documents/invoices/:id/return` (M)
- Per line: returnable quantity stepper (sold − already returned), "Return to stock" switch (default on). Reason*. Summary: credit amount (net + tax), effect on balance, refund due (with method selector when a refund is needed). `POST /invoices/:id/returns`. Requires connection.

### F6 Share — sheet
- **Share PDF** (system share sheet with the server-rendered PDF) · **Send on WhatsApp** (opens WhatsApp to the customer's number with the standard message; the user attaches the PDF from the share sheet when WhatsApp is chosen there) · **Print** (system print dialog). PDF is fetched from `GET /…/pdf` and cached on device.

---

## G. Reports (under More)

### G1 Reports — `/more/reports` (M: organization; S: own sales, no cost or profit)
- **Range selector:** Today · 7 days · This month · Last month · Custom.
- **KPIs:** Net sales (excl. tax) with invoice count · Tax collected · Cost of goods sold (M) · Gross profit and margin (M) · Outstanding (as of now, labelled so).
- **Sales by team member:** horizontal bar chart (M); S sees their own total only.
- **Invoice status:** stacked bar + legend table (count, amount, share) for Paid, Partial, Unpaid, Overdue.
- **Inventory valuation** (M): total at cost, units, link to list of top products by value.
- **Action:** Export CSV (M) → share sheet.
- **Data:** `/reports/*`. Requires connection (shows last loaded figures with timestamp when offline).

---

## H. More and settings

### H1 More — `/more`
- Profile header (name, role, organization). Rows: Customers · Reports · Sync queue (badge) · Team (O) · Business settings (O/M) · Appearance (System / Light / Dark) · About · Sign out (confirmation; warns if unsynced items exist).

### H2 Sync queue — `/more/sync`
- Pending and failed operations: type, summary, created time, state (Waiting, Sending, Needs attention + reason). Actions per item: Retry, Edit and resubmit (opens the relevant form), Discard (confirmation). "Sync now" button.

### H3 Business settings — `/more/settings` (O; M read-only)
- Company profile (name, legal name, TRN, address, phone, logo, invoice footer) · Regional (currency, timezone — locked once documents exist) · Tax rates (list, add, set default, deactivate) · Sales rules (maximum markup, default markups, default credit days, quotation validity, low-stock threshold, allow offline invoicing).

### H4 Team — `/more/team` (O)
- Members list with role and status; invite (name, email, role); change role; deactivate (ends their sessions).

---

## Acceptance checklist per screen (Definition of Done)

1. Matches this specification at 360×640, 390×844 and 834×1194, light and dark, at 100% and 200% text scale.
2. Loading, empty, error and offline states implemented and covered by widget tests.
3. Every control has a semantics label and a ≥ 48 dp target.
4. Role restrictions verified with S and M test accounts — including that S responses contain no cost fields.
5. No literal colours, sizes or strings in the widget tree (tokens and ARB only).
6. Golden screenshots recorded and reviewed.
