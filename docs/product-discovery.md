# Velora — Product Discovery

**Reference:** https://velora-sales-inventory.sujankarki15357.chatgpt.site/
**Audited:** 2026-11-15 · **Method:** full read of the shipped application bundle (`page-*.js`, 40 KB, the entire app) plus a scripted Playwright walkthrough at 1440×900, 820×1180 and 390×844.
**Evidence:** screenshots and the script are in [`reference-screenshots/`](reference-screenshots/) (`d*` desktop, `m*` mobile, `t*` tablet, `audit-script.js`).

Everything below was observed directly. Where the reference has no behaviour, that is stated as **Not present** rather than guessed.

---

## 1. What the reference actually is

The reference is a **single-page, client-only demo**. This shapes the whole project, so it is stated first.

| Fact | Evidence |
|---|---|
| No backend, no API. The only network calls are static assets and Cloudflare bot checks. | Request log in audit run |
| All data lives in the browser: `localStorage["velora-products"]` and `localStorage["velora-records"]`. Sidebar footer reads "Demo data is saved on this device". | Source, audit run |
| No login. "Roles" are a dropdown ("Viewing as: Manager / Ahmed · Sales") that anyone can change. Role resets to Manager on reload. | Source, audit run |
| One company is hardcoded: "Velora Fine Jewellery LLC", Dubai, +971 56 725 2392. Currency AED, locale `en-AE`, VAT 0%/5% and year `2026` in document numbers are hardcoded. | Source |
| Three of four dashboard KPIs and the whole "Latest sales" list are hardcoded literals, unrelated to stored data. | Source |
| Seed data: 4 products, 3 documents (2 invoices, 1 quotation). | Source |
| Built with a Next-style React framework; page is tagged `codex-preview: development`. | HTML head |

**Consequence:** the mobile product cannot "integrate with" the reference. The backend, database, authentication, multi-user behaviour and every server-side rule are **new design**, derived from the business intent the demo expresses. This document separates *observed behaviour* from *design decisions* (the latter live in the architecture, database and API documents and in [Open questions](#9-open-questions-and-assumptions)).

## 2. Navigation structure

- **Desktop / tablet (> 760 px):** fixed left sidebar — 01 Overview · 02 Inventory · 03 New sale · 04 Invoices · 05 Reports.
- **Phone (≤ 760 px):** bottom bar — Home · Inventory · Sale · Invoices. **Reports is unreachable on phones.**
- **Top bar (all pages):** company eyebrow, page title, role switch, "+ Add inventory" (manager; hidden on phones), Cart button with unit count.
- **Overlays (not routes):** Add inventory modal, Price-this-item modal, Cart drawer, Record payment modal, Document view. None has a URL; browser Back leaves the app; nothing is deep-linkable.

## 3. Roles and permissions (as implemented)

| Capability | Manager | Sales ("Ahmed") |
|---|---|---|
| Add inventory | Yes | No (button and quick action hidden) |
| See purchase price / inventory value / profit amounts | Yes | No — shown as "Protected", "—", or "Selling from" price |
| See default profit % | Yes | **Yes** |
| See minimum profit % on cards | Yes | No (but visible in the pricing modal: "Minimum 15%") |
| Price items, build cart, create quotation / invoice | Yes | Yes |
| See documents | All | Only those with salesperson "Ahmed" |
| Reports | All staff, all figures | Own sales only; cost and profit "Protected" |

**Finding — cost protection is ineffective.** A salesperson sees the selling price *and* the profit % that produced it, so cost = price ÷ (1 + %). Reports also show them gross-profit percentage ("16% of invoice value") next to "Protected".

## 4. Page inventory

### 4.1 Overview (Home)
- **Purpose:** business snapshot and entry points.
- **Outputs:** hero "Inventory purchase value" (Σ purchase price × quantity; "Protected" for sales) with units and product count; KPI cards Today's sales, In stock, Outstanding, Monthly profit; "Latest sales" list; Quick actions; low-stock alert banner.
- **Actions → destinations:** Browse inventory → Inventory; Add new stock → Add inventory modal (manager); Start a customer sale → New sale; Review low stock → Inventory; View all → **nothing (no handler)**.
- **Calculated live:** inventory value, units in stock, product count, low-stock banner (quantity ≤ 8).
- **Hardcoded:** Today's sales AED 8,450 "↑ 12.4%", Outstanding AED 12,500 "3 credit invoices", Monthly profit AED 18,450 "24.5%", the three "Latest sales" rows (which contradict stored records: INV-2026-00123 is listed as a paid invoice, but the stored record 123 is quotation QT-2026-00123 with a different amount), greeting "Good afternoon, Sujan".
- **Implied API:** dashboard summary, recent documents, low-stock list.
- **UX problems:** dead "View all"; "Review low stock" does not apply the Low-stock filter; marketing hero consumes the first screen on phones; static numbers presented as live.

### 4.2 Inventory
- **Purpose:** browse stock.
- **Inputs:** search (name or SKU, case-insensitive substring); filter chips All items / In stock / Low stock.
- **Outputs per card:** image or gradient placeholder, stock badge, SKU, weight, name, description, price (manager: purchase price; sales: "Selling from" = cost × (1 + default %)), available quantity, default profit %, minimum profit % (manager only), "Price this item".
- **Rules:** Low stock = quantity ≤ 8 (hardcoded, global). "In stock" = quantity **> 8**, so a low-stock item is *not* "in stock", and a zero-quantity item is labelled "Low stock". Count line "Showing N product lines".
- **Actions:** tapping a card opens the pricing modal (same as New sale). **Not present:** product detail, edit, delete/archive, stock adjustment, restock of an existing product, movement history, sorting, pagination, categories, barcode.
- **Empty state:** "No products found — Try another search or filter."

### 4.3 Add purchased inventory (modal, manager only)
- **Fields:** photo (optional, any image, stored as a base64 data-URL in localStorage); Item name*; SKU (auto `VLR-` + last 5 digits of the timestamp if blank); Weight* (number, step 0.01) + unit (g / kg / pcs); Description*; Quantity purchased* (min 1, default 100); Purchase price per item* (min 0, step 0.01, default 100); Default profit %* (default 30); Minimum profit %* (default 15).
- **Output:** live "Total purchase price" = quantity × price.
- **Result:** always creates a **new product** at the top of the list; toast "<name> added to inventory".
- **Validation gaps (verified):** duplicate SKU accepted (two products with `VLR-BR-001`); minimum % may exceed default % (min 40 / default 10 accepted — pricing slider then silently starts at 40 while the card says "Default 10%"); no upper bound on %; "pcs" offered as a weight unit; no supplier, date or reference; a purchase of an existing item cannot be recorded.

### 4.4 New sale
- **Purpose:** choose items to price.
- **Outputs:** intro panel with cart summary; search; list of products with quantity > 0 (thumbnail, SKU · weight, name, description, available, price, "Set price").
- **Actions:** Set price → pricing modal; cart summary → cart drawer.
- **Not present:** barcode scan, quantity entry in the list, customer selection up front.

### 4.5 Price this item (modal) — "Live profit calculator"
- **Inputs:** profit % slider (integer steps, min = product minimum %, max = 60, starts at default %); quantity stepper (1 … available).
- **Outputs:** purchase price and profit per item (manager) or "N% applied" (sales); selling price = cost × (1 + %/100); line total.
- **Action:** Add to cart → toast "<name> added to cart".
- **Rules:** the **minimum applies to managers too** (the copy says only salespeople are restricted). Maximum 60% is hardcoded.

### 4.6 Cart drawer — "Review cart"
- **Section 1, customer:** name ("*"), company, WhatsApp/mobile, email, address. The data model has a `trn` (tax registration number) field with **no input**. Buttons enable when the cart is non-empty and name **or** company is filled (the label suggests name is mandatory). No format validation (invalid email accepted). No customer directory — details are retyped every time.
- **Section 2, items:** line = product + markup. Adding the same product at the same % merges lines (capped at stock); a different % creates a second line. Remove only — **quantity and price cannot be edited in the cart**.
- **Adjustments:** order discount (absolute AED); VAT rate 0% or 5% (default 5%).
- **Totals:** `subtotal = Σ unit price × qty`; `taxable = max(0, subtotal − discount)`; `VAT = taxable × rate`; `total = taxable + VAT`. Floating point, no rounding; displayed with zero decimals.
- **Actions:** Save quotation; Proceed to invoice.
- **Defects (verified):**
  - Negative discount accepted (−500 raised the total).
  - Discount larger than subtotal accepted; total clamps to 0 but the stored discount is the raw number.
  - **Overselling:** two lines of the same product at different % each allow the full stock (sold 8 of a 4-in-stock bracelet). Stock is then clamped to 0 with no warning.
  - Customer details, discount and VAT choice live only while the drawer is open. Closing it — including to view a just-saved quotation — discards them. Observed: quotation saved with discount AED 100.50, the invoice created next from the same cart had discount 0 and no company/mobile.
  - Cart is not persisted (lost on reload).

### 4.7 Record payment (modal) — "Final step"
- **Options:** Cash · Bank Transfer · Credit · Partial.
- **Fields:** Cash/Bank/Partial → "Amount received now" (defaults to total); Bank Transfer → optional reference number; Credit → credit period in days (default 30) with computed due date.
- **Status rule:** Credit → status **Credit**, received 0. Otherwise received ≥ total → **Paid**, else **Partial** — regardless of which option was picked (choosing "Partial" and leaving the full amount yields Paid; choosing "Cash" with less yields Partial).
- **Action:** Generate final invoice → creates the invoice, **deducts stock**, clears the cart, opens the document, toast "<number> finalized · stock updated".
- **Defects:** amount may exceed the total or be negative (verified: −50 shows "AED 67,269 remaining"); "Partial" is a status, not a payment method, so the real method of a partial payment is lost; a partial invoice has no due date; the modal cannot be dismissed by backdrop/Escape.

### 4.8 Quotations & invoices
- **Inputs:** search (number, customer name, company); status chips All / Paid / Credit / Partial / Quotation.
- **Columns:** Document (number, type · date) · Customer (company or name, mobile) · Salesperson (+ line count) · Total · Status · View.
- **Scope:** sales role sees own documents only.
- **Not present:** date filter, sorting, pagination, overdue indicator, **recording a later payment on a Credit/Partial invoice**, converting a quotation to an invoice, cancelling, returns, editing.

### 4.9 Document view (quotation / invoice)
- **Outputs:** seller block, bill-to, items (name, SKU, **"N% profit"**, qty, unit price, total), payment method, status, due date, bank reference, subtotal, discount, VAT, total, balance due (Partial only), footer.
- **Actions:** Back; Print / Save PDF (browser print); Send via WhatsApp (opens `wa.me/<digits>` with a prefilled text containing number and total — **text only, the document is not attached**).
- **Defects:** the customer-facing document **prints the seller's profit percentage on every line**; no seller or customer tax registration number although VAT is charged; email and TRN never shown.

### 4.10 Reports
- **Scope:** invoices only (quotations excluded); sales role → own invoices.
- **KPIs:** Sales revenue = Σ invoice total (VAT included); Purchase cost = Σ cost × qty; Gross profit = Σ (unit price − cost) × qty (ignores discounts); margin label = profit ÷ VAT-inclusive revenue; Outstanding = Σ max(0, total − received).
- **Charts:** Sales by team member (bar per hardcoded name "Manager"/"Ahmed"); Invoice status (count and share of Paid / Credit / Partial).
- **Not present:** date range, any filter, export, inventory or product reports, drill-down.

## 5. Feature inventory (summary)

See [`feature-matrix.md`](feature-matrix.md) for the full matrix with the mobile decision for each feature.

## 6. Business rules extracted

| # | Rule (as implemented) | Assessment |
|---|---|---|
| R1 | Selling price = purchase price × (1 + markup %). "Profit %" is markup on cost, not margin on price. | Keep; name it precisely. |
| R2 | Markup bounded to [product minimum, 60]; integer percent. | Keep bounds; make the maximum a setting. |
| R3 | Stock is deducted when an invoice is finalized, not when quoted. | Keep. |
| R4 | Quotations do not reserve stock. | Keep; state it in the UI. |
| R5 | Quantity per line ≤ available stock. | Enforce per *product* across lines, and on the server. |
| R6 | Order-level absolute discount, applied before tax. | Keep; validate 0 ≤ discount ≤ subtotal. |
| R7 | Tax = (subtotal − discount) × rate; prices are tax-exclusive; rate chosen per document (0% / 5%). | Keep; rates become configurable. |
| R8 | Status: Credit (nothing received, due date), Partial, Paid; Quotation is a separate document type. | Split into payment *terms*, payment *method* and payment *status*. |
| R9 | Due date = issue date + credit days (default 30). | Keep; default configurable. |
| R10 | Document numbers `INV-2026-NNNNN` / `QT-2026-NNNNN`; next number derived from list length (quotation numbers depend on the count of *all* documents — collisions and gaps). | Replace with per-type, per-year gapless server sequences. |
| R11 | Low stock = quantity ≤ 8. | Organization default + per-product reorder level; separate "Out of stock". |
| R12 | Sales staff cannot see cost or profit amounts and see only their own documents. | Keep, and make it real (server-side field filtering). |
| R13 | Gross profit = Σ (price − cost) × qty; revenue includes VAT. | Redefine: net revenue excludes tax and discount (see system rules). |
| R14 | Money is displayed with zero decimals and computed in binary floating point. | Replace with integer minor units and defined rounding. |

## 7. States

- **Empty:** inventory search, document list, cart ("Your cart is empty"). Reports show zeros.
- **Loading:** none (data is local and synchronous).
- **Error:** none. Corrupt localStorage silently falls back to seed data. Invalid numeric input yields `NaN` totals.
- **Feedback:** a single toast style, auto-dismiss after 2.6 s, success only.
- **Confirmation dialogs:** none anywhere (removing a cart line and finalizing an invoice are immediate).

## 8. Responsive behaviour

- Breakpoints 1120 px and 760 px. ≤ 760 px: sidebar replaced by bottom bar, "+ Add inventory" hidden (only reachable from the Home quick action), grids collapse to one column.
- 19 of 22 interactive controls on the phone Home screen are smaller than 44 px; body text is commonly 8–10 px.
- Product cards are about 420 px tall on a phone — two products per screen.
- A toast overlays the cart's totals (see `m05-cart.png`).
- Escape does not close modals; no focus trapping.

## 9. Open questions and assumptions

These materially affect implementation. Each has a recommended default so work is not blocked; they are consolidated with trade-offs in [`implementation-roadmap.md`](implementation-roadmap.md#1-decisions-needed).

1. **Cost secrecy vs. markup-based selling** — hide % from sales staff and let them choose a price between a floor and ceiling (recommended), or keep showing %?
2. **Costing method** when the same product is bought again at a different price — moving weighted average (recommended) vs. FIFO / per-piece.
3. **May managers sell below the minimum markup?** Recommended: yes, with a mandatory reason and audit entry.
4. **Returns and cancellations** — absent in the reference; proposed rules need confirmation.
5. **Jewellery attributes** (metal, purity, stone details, making charges) — the reference stores only a free-text description and a weight. Recommended: not in v1.
6. **Suppliers / purchase orders** — the reference records a purchase with no supplier. Recommended: v1 stock receipts with an optional supplier name; full module later.
7. **Tax** — is 0% / 5% VAT on the discounted order total correct for every sale Velora makes, and are prices always tax-exclusive?
8. **Offline invoicing** — allow finalizing invoices without connectivity (provisional number, stock confirmed later), or drafts and quotations only (recommended default)?
9. **Single shop or multiple branches?** Schema supports branches; UI assumes one until told otherwise.
10. **Payment methods** — only Cash and Bank Transfer exist. Is card needed?
