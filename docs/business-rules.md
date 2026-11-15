# Velora — Business Rules

The authoritative definition of every calculation and state change. The API implements these rules; the app mirrors only the arithmetic it needs for instant feedback and always defers to the server's result. Each rule states its origin: **[Ref]** observed in the reference, **[Fix]** reference intent corrected, **[New]** not in the reference — an assumption awaiting approval.

## 1. Numeric foundations

| Rule | Definition |
|---|---|
| N1 Money **[Fix]** | Stored and transmitted as integers in the currency's minor unit (`*_minor`; AED 2,980.95 = `298095`). No floating point anywhere in a money path. In Dart: `int`; in TypeScript: `bigint` in the domain layer, serialized as JSON integers (documents are limited to totals below 2^53 minor units, validated). |
| N2 Rates **[Fix]** | Markup and tax rates are integers in basis points (`*_bp`; 30% = 3000, 5% = 500). |
| N3 Rounding **[New]** | Every division rounds **half up** to the minor unit (`(a × b + d/2) div d` on non-negative integers). Rounding happens once per defined step below, never on intermediate values. |
| N4 Settings **[Fix]** | Currency, currency exponent, timezone, tax rates, maximum markup, default markups, credit days, low-stock threshold and document prefixes are organization settings. Nothing regional is hardcoded. Currency and timezone are locked after the first document. |
| N5 Dates **[New]** | Timestamps are stored in UTC. "Today", "this month", due dates and document-number years are evaluated in the organization timezone. |

## 2. Pricing

| Rule | Definition |
|---|---|
| P1 Selling price from markup **[Ref]** | `price(m) = round_half_up(cost_minor × (10000 + m_bp) / 10000)`. "Profit %" in the reference is markup on cost. |
| P2 List, floor, ceiling **[Ref]** | `list = price(default_markup)`, `floor = price(min_markup)`, `ceiling = price(org.max_markup)` (reference: 60%). |
| P3 Product policy validation **[Fix]** | `0 ≤ min_markup ≤ default_markup ≤ org.max_markup`. The reference accepted min > default. |
| P4 Line price validation **[Fix]** | A line's `unit_price_minor` must satisfy `floor ≤ unit_price ≤ ceiling`, checked on the server against the product's current cost and policy at the time of the request. |
| P5 Below-minimum override **[New — D3]** | A Manager or Owner may submit `floor > unit_price ≥ 0` with a non-empty `belowMinimumReason`; it is written to the audit log. Sales role: never. |
| P6 Stored markup **[New]** | The line stores `unit_price_minor` (authoritative) and `markup_bp = floor((unit_price − unit_cost) × 10000 / unit_cost)` for reporting (0 when cost is 0). |
| P7 Cost confidentiality **[Fix — D1]** | Responses to the Sales role never contain cost, markup or profit fields. They receive list, floor and ceiling prices. Customer-facing documents never show cost, markup or profit. |

## 3. Document totals

For a quotation or invoice with lines `i`:

| Step | Definition |
|---|---|
| T1 Line total **[Ref]** | `line_total_i = unit_price_i × quantity_i` |
| T2 Subtotal **[Ref]** | `subtotal = Σ line_total_i` |
| T3 Discount **[Fix]** | One absolute order-level amount with `0 ≤ discount ≤ subtotal`. Out-of-range values are rejected (the reference accepted negatives and clamped excess). |
| T4 Tax **[Ref]** | Prices are tax-exclusive. `taxable = subtotal − discount`; `tax = round_half_up(taxable × tax_rate_bp / 10000)`. One tax rate per document, chosen from the organization's active rates; its name and rate are snapshotted on the document. |
| T5 Total **[Ref]** | `total = taxable + tax` |
| T6 Allocation **[New]** | For returns and profit, the discount and the tax are allocated to lines in proportion to `line_total_i` (tax: to `line_total_i − discount_alloc_i`) using the largest-remainder method, so allocations sum exactly to the document figures. |

**Assumption A-TAX:** a single tax-exclusive rate on the discounted total is correct for all of Velora's sales. Sector-specific VAT treatments for precious metals are **not** modelled (decision D7).

## 4. Stock

| Rule | Definition |
|---|---|
| S1 Ledger **[New]** | Stock changes only by inserting a `stock_movements` row; `stock_levels.quantity` is updated in the same transaction and always equals the sum of the product/branch movements. Movements are never edited or deleted. |
| S2 Deduction on sale **[Ref]** | Issuing an invoice inserts one `SALE` movement per line (negative) and reduces stock. Quotations do not touch or reserve stock. |
| S3 Sufficiency **[Fix]** | For each product, the summed quantity across all lines must be ≤ on-hand in the selling branch. Enforced atomically: `UPDATE stock_levels SET quantity = quantity − q WHERE … AND quantity ≥ q`; zero rows updated ⇒ the whole invoice is rejected with `INSUFFICIENT_STOCK` listing each short line. Stock can never go negative (`CHECK quantity ≥ 0`). The reference clamped to zero silently. |
| S4 Receipts **[Fix]** | Receiving stock (`PURCHASE_RECEIPT`, or `OPENING` at product creation) adds quantity at a unit cost. |
| S5 Cost **[New — D2]** | Product cost is a moving weighted average over the organization: `new_cost = round_half_up((on_hand × cost + received × unit_cost) / (on_hand + received))`; when `on_hand = 0`, `new_cost = unit_cost`. Each sale line snapshots the cost at the time of sale; later cost changes never alter past profit. |
| S6 Adjustments **[New]** | Manager only, mandatory reason, `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` at current cost. An out-adjustment larger than on-hand is rejected. |
| S7 Cancellation **[New — D4]** | Cancelling an invoice inserts `SALE_CANCELLATION` movements restoring every not-yet-returned unit at the line's snapshot cost (cost re-averaged per S5). |
| S8 Returns **[New — D4]** | A return line with `restock = true` inserts a `CUSTOMER_RETURN` movement at the line's snapshot cost. With `restock = false` no movement is created and the cost stays in cost of goods sold. |
| S9 Stock status **[Fix]** | `OUT` if quantity = 0; `LOW` if 0 < quantity ≤ reorder level (product's, else organization threshold — reference: 8); otherwise `IN_STOCK`. "Needs attention" = OUT + LOW. |
| S10 Archiving **[New]** | Products are archived, never deleted. A product with stock on hand cannot be archived. Archived products stay on historical documents. |

## 5. Documents and numbering

| Rule | Definition |
|---|---|
| D1 Numbering **[Fix]** | `{PREFIX}-{YYYY}-{NNNNN}` (reference format kept: `INV-2026-00126`). One gapless sequence per organization, document type and year, allocated inside the creating transaction by locking the sequence row. Numbers are never reused; a cancelled invoice keeps its number. |
| D2 Snapshots **[Ref]** | Documents copy the customer's details and each product's name, SKU, cost and price at issue. Later edits to customers or products do not change issued documents. |
| D3 Immutability **[New]** | An issued invoice's lines and totals are never edited. Corrections are made by cancellation or return. |
| D4 Quotations **[Fix]** | States: `OPEN` → `CONVERTED` (exactly one invoice) or `CANCELLED`; `EXPIRED` is derived when `valid_until` has passed. Conversion re-validates stock and price bounds against current data and may be edited before issue. |
| D5 Visibility **[Ref]** | Sales role sees and acts on only documents where they are the salesperson. |
| D6 Salesperson **[Ref]** | The authenticated user who creates the document. |

## 6. Payments

| Rule | Definition |
|---|---|
| Y1 Model **[Fix]** | A payment is a row `(invoice, kind PAYMENT|REFUND, method CASH|BANK_TRANSFER, amount > 0, reference, received_at, recorded_by)`. Payments are never edited or deleted; a mistake is corrected by a `REFUND` with a note. "Credit" and "Partial" are not methods. |
| Y2 Balance **[Fix]** | `paid = Σ PAYMENT − Σ REFUND`; `balance = total − returned − paid`. |
| Y3 Status **[Ref, formalised]** | `PAID` if balance = 0; `UNPAID` if paid = 0 and balance > 0 (the reference's "Credit"); otherwise `PARTIAL`. |
| Y4 Bounds **[Fix]** | `0 < payment ≤ balance`. Overpayment and non-positive amounts are rejected. A refund may not exceed `paid`. |
| Y5 Terms **[Ref]** | When an invoice is issued with balance > 0, `due_date = issue date + credit_days` (default from settings, reference: 30; minimum 0) or an explicit date. The reference set no due date for partial invoices; here every invoice with a balance has one. |
| Y6 Overdue **[New]** | Derived, not stored: `status = ISSUED and balance > 0 and due_date < today`. |
| Y7 Customer credit **[New]** | No credit limit and no customer-level prepayment balance in v1; exposure is reported per customer. |
| Y8 Idempotency **[New]** | Creating invoices, payments, returns, cancellations, receipts and adjustments requires an `Idempotency-Key`; a repeat returns the original result and creates nothing. |

## 7. Cancellations and returns  *(not in the reference — D4)*

| Rule | Definition |
|---|---|
| C1 Who | Manager or Owner, with a mandatory reason, audit-logged. |
| C2 Cancel invoice | Allowed when `ISSUED` and it has no returns. In one transaction: record a `REFUND` for the full `paid` amount (method supplied), restore stock (S7), set `CANCELLED`. The invoice remains visible; it is excluded from sales, profit and outstanding. |
| C3 Return | For chosen lines, `quantity ≤ sold − already returned`. Credit per line: `net = round_half_up((line_total − discount_alloc) × q / quantity)` and `tax = round_half_up(line_tax × q / quantity)`; when a return brings a line to fully returned, the credit is the line's remaining uncredited amount, so no rounding residue is left. A numbered credit note (`CN-YYYY-NNNNN`) is created. |
| C4 Money on return | `returned` increases by the credit. If the new balance would be negative, the request must include a refund for exactly the excess; otherwise the credit simply reduces the balance. |

## 8. Reporting definitions

All figures cover invoices with `status = ISSUED`, attributed to the issue date; returns reduce figures on the date of the return. Sales role: own invoices, no cost or profit.

| Metric | Definition | Reference difference |
|---|---|---|
| Invoiced total | `Σ total` (tax included) | Reference "Sales revenue" |
| Net sales | `Σ (subtotal − discount) − Σ return net` | New headline figure |
| Tax collected | `Σ tax − Σ return tax` | New |
| Cost of goods sold | `Σ unit_cost × quantity − Σ unit_cost × restocked returned quantity` | Reference ignored returns (none existed) |
| Gross profit | `Net sales − COGS` | Reference ignored discounts |
| Gross margin | `Gross profit / Net sales` | Reference divided by tax-inclusive revenue |
| Outstanding | `Σ balance` over issued invoices, as of now | Same intent |
| Overdue | Outstanding where Y6 holds | New |
| Inventory value | `Σ on_hand × cost` | Same as reference |
| Today's sales (dashboard) | Invoiced total for today; delta vs. yesterday's full day | Reference value was hardcoded |
| Month profit (dashboard) | Gross profit and margin, month to date | Reference value was hardcoded |

## 9. Authorization summary

| Action | Owner | Manager | Sales |
|---|---|---|---|
| View products (prices only) / with cost | ✓ / ✓ | ✓ / ✓ | ✓ / ✗ |
| Create, edit, archive product; receive; adjust | ✓ | ✓ | ✗ |
| Customers: view, create, edit | ✓ | ✓ | ✓ |
| Create quotation / invoice; record payment | ✓ | ✓ | ✓ (own documents) |
| Sell below minimum | ✓ | ✓ | ✗ |
| Cancel invoice, returns, refunds | ✓ | ✓ | ✗ |
| View documents | all | all | own |
| Reports | all | all | own, no cost/profit |
| Business settings, tax rates | ✓ | read | ✗ |
| Team management | ✓ | ✗ | ✗ |
