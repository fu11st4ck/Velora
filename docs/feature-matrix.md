# Velora — Feature Matrix

**Reference** column: ✅ works · ⚠️ present but defective · 🎭 displayed but fake/hardcoded · ❌ not present.
**Mobile** column: **Keep** (same intent), **Fix** (same intent, corrected), **New** (not in reference), **Later** (deliberately deferred).
Priority: P0 = required for a usable v1, P1 = v1 if schedule allows, P2 = after v1.

| Area | Feature | Reference | Mobile | Pri | Sprint | Notes |
|---|---|---|---|---|---|---|
| Access | Login, sessions, password reset | ❌ | New | P0 | 1 | Reference has a role dropdown only |
| Access | Roles: Owner / Manager / Sales | ⚠️ client toggle | Fix | P0 | 1 | Enforced by API; cost fields stripped server-side |
| Access | Staff management (invite, deactivate, change role) | ❌ | New | P1 | 5 | |
| Org | Company profile, currency, timezone, tax rates, thresholds | 🎭 hardcoded | New | P0 | 1 | Settings screen in Sprint 5; seeded earlier |
| Dashboard | Inventory value (manager) | ✅ | Keep | P0 | 5 | |
| Dashboard | Units in stock, product count | ✅ | Keep | P0 | 5 | |
| Dashboard | Today's sales + change vs yesterday | 🎭 | Fix | P0 | 5 | Real calculation |
| Dashboard | Outstanding + count | 🎭 | Fix | P0 | 5 | Adds overdue amount |
| Dashboard | Month profit + margin (manager) | 🎭 | Fix | P0 | 5 | |
| Dashboard | Latest sales | 🎭 | Fix | P0 | 5 | Real documents; "View all" works |
| Dashboard | Low-stock alert → filtered list | ⚠️ filter not applied | Fix | P0 | 5 | |
| Dashboard | Quick actions | ✅ | Keep | P0 | 5 | Role-aware |
| Inventory | List, search by name/SKU | ✅ | Keep | P0 | 2 | Server search, paginated |
| Inventory | Filter All / In stock / Low stock | ⚠️ labels wrong at qty 0 | Fix | P0 | 2 | Adds Out of stock |
| Inventory | Sort (name, stock, recently added) | ❌ | New | P1 | 2 | |
| Inventory | Barcode field and camera scan | ❌ | New | P1 | 2 / 4 | Mobile-native gain; optional field |
| Inventory | Product detail | ❌ | New | P0 | 2 | |
| Inventory | Add product with photo | ⚠️ no validation | Fix | P0 | 2 | Unique SKU; min ≤ default ≤ max |
| Inventory | Edit / archive product | ❌ | New | P0 | 2 | Archive, never hard-delete |
| Inventory | Receive more stock of an existing product | ❌ | New | P0 | 2 | Weighted-average cost |
| Inventory | Stock adjustment with reason | ❌ | New | P0 | 2 | |
| Inventory | Stock movement history | ❌ | New | P0 | 2 | |
| Inventory | Per-product reorder level | ❌ (global 8) | New | P1 | 2 | Org default retained |
| Inventory | Categories | ❌ | Later | P2 | — | No evidence in reference |
| Inventory | Jewellery attributes (metal, purity, stones) | ❌ | Later | P2 | — | Pending owner input |
| Customers | Capture customer on a sale | ✅ | Keep | P0 | 3 | |
| Customers | Customer directory, search, reuse | ❌ | New | P0 | 3 | Stops retyping |
| Customers | Tax registration number | ⚠️ in data, no input | Fix | P0 | 3 | |
| Customers | Customer detail: history and balance | ❌ | New | P1 | 3 | |
| Suppliers | Supplier name on stock receipt | ❌ | New | P1 | 2 | Free text |
| Suppliers | Supplier directory, purchase orders | ❌ | Later | P2 | — | See roadmap decision D6 |
| Sales | Product picker with search | ✅ | Keep | P0 | 4 | |
| Sales | Markup/price control with floor and ceiling | ✅ | Keep | P0 | 4 | Maximum from settings |
| Sales | Quantity ≤ stock | ⚠️ per line only | Fix | P0 | 4 | Per product, server-enforced |
| Sales | Cart, remove line | ✅ | Keep | P0 | 4 | |
| Sales | Edit quantity / price in cart | ❌ | New | P0 | 4 | |
| Sales | Cart survives navigation and restart | ❌ | New | P0 | 4 | Local draft |
| Sales | Order discount (amount) | ⚠️ negative / excess allowed | Fix | P0 | 4 | |
| Sales | Tax rate selection | ⚠️ hardcoded 0/5 | Fix | P0 | 4 | From settings |
| Sales | Save quotation | ⚠️ loses state, odd numbering | Fix | P0 | 4 | |
| Sales | Convert quotation → invoice | ❌ | New | P0 | 4 | |
| Sales | Quotation validity / expiry | ❌ | New | P1 | 4 | |
| Payments | Full payment at sale (cash / bank) | ✅ | Keep | P0 | 4 | |
| Payments | Partial payment at sale | ⚠️ method lost | Fix | P0 | 4 | Method recorded |
| Payments | Credit sale with due date | ✅ | Keep | P0 | 4 | |
| Payments | Bank reference | ✅ | Keep | P0 | 4 | |
| Payments | Record later payments on an invoice | ❌ | New | P0 | 4 | |
| Payments | Overdue indicator | ❌ | New | P0 | 4 | Derived |
| Payments | Overpayment / negative amount blocked | ❌ | New | P0 | 4 | |
| Documents | Combined quotation + invoice list | ✅ | Keep | P0 | 4 | |
| Documents | Search, status filter | ✅ | Keep | P0 | 4 | Adds Overdue, Cancelled, date range |
| Documents | Document view | ⚠️ shows profit % to customer | Fix | P0 | 4 | Profit removed; TRNs added |
| Documents | PDF | ⚠️ browser print | Fix | P0 | 4 | Server-rendered PDF |
| Documents | Share via WhatsApp | ⚠️ text only | Fix | P0 | 4 | Share sheet with the PDF; WhatsApp deep link kept |
| Documents | Cancel invoice (restores stock) | ❌ | New | P0 | 4 | Manager |
| Documents | Returns / credit notes | ❌ | New | P1 | 4 | Manager |
| Reports | Revenue, cost, gross profit, outstanding | ⚠️ definitions | Fix | P0 | 5 | Net-of-tax definitions |
| Reports | Sales by team member | ⚠️ hardcoded names | Fix | P0 | 5 | |
| Reports | Invoice status breakdown | ✅ | Keep | P0 | 5 | |
| Reports | Date range | ❌ | New | P0 | 5 | |
| Reports | Inventory valuation report | ❌ | New | P1 | 5 | |
| Reports | CSV export | ❌ | New | P1 | 5 | |
| Reports | Reachable on phones | ❌ | Fix | P0 | 5 | Under More |
| Platform | Offline read, drafts, queued writes | ❌ | New | P1 | 6 | |
| Platform | Audit log (server) | ❌ | New | P0 | 1+ | Viewer UI is P2 |
| Platform | Dark theme | ❌ | New | P1 | 1 | |
| Platform | Push notifications | ❌ | Later | P2 | — | Low-stock and overdue shown in-app first |
| Platform | Expenses, multi-branch transfers | ❌ | Later | P2 | — | No evidence in reference |

## Reference behaviour intentionally not carried over

| Behaviour | Why |
|---|---|
| Role switch dropdown | Replaced by real accounts. A demo build flavour may keep seeded demo logins. |
| "Partial" and "Credit" as payment *methods* | They are outcomes; modelled as status and terms. |
| "pcs" as a weight unit | Not a weight. Weight is optional; quantity is always in pieces. |
| Profit % printed on customer documents | Leaks margin to customers. |
| Marketing hero on Home | Costs a full phone screen and carries no information. |
| Hardcoded KPIs | Replaced with real figures. |
