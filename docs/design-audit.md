# Velora — Design Audit

Audit of the reference web application as a product, with the redesign direction for Android and iOS. Evidence: [`reference-screenshots/`](reference-screenshots/); measurements are from the shipped stylesheet and the scripted walkthrough.

## 1. What works — keep

| Strength | Detail |
|---|---|
| A distinct identity | Deep wine `#45151F`, antique gold `#B28A50`, warm paper `#FBFAF8`, serif headings and a diamond "V" monogram. It reads as a jewellery house, not a generic admin panel. |
| Calm surfaces | White cards on warm paper with hairline borders and almost no shadow. Figures stand out. |
| Clear status language | Paid = green, Credit/Partial = amber, Quotation = slate, consistently applied as pills. |
| The pricing interaction | One control (markup) with instant selling price and line total is the best idea in the product. |
| Plain wording | "Price this item", "Record payment", "Status after saving: Paid in full" tell the user what will happen. |
| Document layout | The invoice is clean and printable. |

## 2. What does not work

### 2.1 Legibility and accessibility
| Issue | Evidence | Fix |
|---|---|---|
| Type far too small | Most frequent sizes are 9, 10 and 8 px; some labels are 7 px | 12 sp minimum; body 14–16 sp; honour system text scaling |
| Low contrast | Gold eyebrow text on paper ≈ 3:1; muted grey captions on cream | Darker gold for text; 4.5:1 minimum for body text |
| Small touch targets | 19 of 22 controls on phone Home are under 44 px | 48 dp minimum |
| No keyboard / assistive support | Escape does not close modals; no focus trap; cart close and steppers lack labels | Semantics labels on every control; logical focus order |
| Status by colour alone in charts | Status dots in Reports | Colour + label + value always |

### 2.2 Information hierarchy
- Home opens with a 320 px marketing headline on phones; the first real number is below the fold.
- Product cards spend ~200 px on a placeholder gradient; two products fit per screen. An inventory list needs 6–8.
- Money has no decimals; AED 2,980.95 displays as AED 2,981 while VAT is computed on fractions, so documents do not visibly add up.
- Dates and document numbers have equal weight to amounts in lists; the amount and status are what users scan for.

### 2.3 Navigation
- Reports cannot be reached on phones. "+ Add inventory" is hidden on phones.
- Everything beyond the five pages is a modal with no back-stack: the system Back gesture exits the app, state is lost when a modal closes, nothing can be deep-linked.
- Tapping a product in *Inventory* starts a sale; there is no way to simply look at a product.
- "View all" is dead; "Review low stock" lands on an unfiltered list.

### 2.4 Forms
- The cart is a single long form: customer (5 fields), items, discount, VAT, totals. On a phone the totals and buttons are off-screen and a toast covers them.
- Customer details are retyped for every sale and lost when the drawer closes.
- No inline validation, no error text, numeric inputs accept negative and oversized values.
- The payment step mixes method, terms and outcome in one row of four radio buttons.
- Numeric fields use the generic keyboard; no currency formatting while typing.

### 2.5 Tables and data
- The documents table collapses poorly on phones (six columns stacked).
- No sorting, date filtering or pagination anywhere.
- Charts: two bars with hardcoded names; share percentages with no totals or period.

### 2.6 Feedback and states
- One toast for everything, success only, 2.6 s, overlapping content.
- No loading, error or offline states (there is no network). No confirmation before irreversible actions such as finalizing an invoice.

## 3. Redesign principles for mobile

1. **Numbers first.** Each screen leads with the figure the user came for, in tabular numerals with currency decimals.
2. **Real navigation.** Five bottom destinations — Home, Inventory, Sell, Documents, More — and real pushed routes for detail and forms, so Back always works and state survives.
3. **Selling is a guided flow, not a form.** Items → Customer → Review → Payment, each step one thumb-reachable screen with a pinned total and a single primary action.
4. **Dense where browsing, spacious where deciding.** 72–88 dp list rows with a 56 dp thumbnail for inventory; generous spacing on pricing and payment.
5. **Never ask twice.** Customers are picked from a directory; drafts persist; the last tax rate and payment method are remembered.
6. **Prevent, then explain.** Controls are bounded (stepper stops at stock, amount field caps at balance) and any server rejection names the line and the reason.
7. **Protect what the role may not see.** The sales role receives no cost data from the API; the UI never shows a markup percentage next to a price for that role.
8. **Keep the brand, drop the decoration.** Wine, gold, paper and the serif stay. The hero, numbered "01/02" ornaments and gradient placeholders go (a small monogram tile stands in for a missing photo).
9. **Adaptive.** Phones: single column, bottom navigation. Tablets ≥ 840 dp: navigation rail and list–detail panes for Inventory and Documents; the cart stays visible beside the product list while selling.

## 4. Screen-level recommendations

| Reference screen | Mobile redesign |
|---|---|
| Overview | KPI grid (2×2) first; then "Needs attention" (low stock, overdue); then recent documents. Greeting reduced to an app-bar subtitle. Quick actions become the Sell tab and contextual buttons. |
| Inventory | Compact rows; sticky search; filter chips (All, In stock, Low, Out) with counts; sort menu; scan button; pull to refresh; infinite scroll. Tap opens **Product detail**. |
| Add inventory | Split into **New product** (identity + pricing policy + opening stock) and **Receive stock** (existing product). Sectioned form, numeric keypads, live total pinned above the keyboard. |
| Price this item | Bottom sheet. Managers see cost, markup %, profit. Sales staff see a price slider between floor and ceiling with a "list price" marker and no percentages. Stepper respects stock minus what is already in the cart. |
| Cart | Its own screen with a pinned summary bar. Lines are editable (swipe to remove, tap to re-price). Customer is one row that opens a searchable picker. |
| Record payment | "Amount received now" with quick chips (Full, Half, None); method segmented control appears only when the amount is above zero; due date appears only when a balance remains. A sentence states the outcome before confirming. |
| Quotations & invoices | Cards: number + status pill on the first line, customer on the second, amount right-aligned; balance and due date shown when relevant. Filter sheet for type, status, date, salesperson. |
| Document view | Native summary (status, amounts, customer, items, payment timeline) with actions in a bottom bar: Record payment, Share, More (cancel, return, convert). The PDF is the customer-facing artefact. |
| Reports | Date-range selector (Today, 7 d, This month, Custom); KPI cards; bar chart by salesperson; status breakdown as a stacked bar with a legend table; export action. |

## 5. Risks in the redesign

- **Price slider for sales staff** changes the mental model from "choose a %" to "choose a price". It is the only way to keep costs private; needs owner approval (roadmap decision D1).
- **More steps in the sale flow** than one drawer. Mitigation: each step has one decision and the common path (existing customer, full cash payment) is four taps after the cart.
- **Serif headings at small sizes** can hurt legibility; the serif is restricted to titles and large figures of 20 sp and above.
