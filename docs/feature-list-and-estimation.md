# Velora — Feature List and Effort Estimate

**Sales & inventory system for jewellery retail** · API · Android · iOS · Web

Prepared 17 November 2026

## 1. Estimate summary

All figures are in **person-days**: one experienced engineer's working day, including unit tests and code review.

| Deliverable | Development | UX / UI design | Subtotal | With project management (10%) and contingency (15%) |
|---|---:|---:|---:|---:|
| Discovery & business rules (all platforms) | — | — | 5 | 6 |
| **API (backend)** | 93 | — | 93 | **118** |
| **Android app** | 91.5 | 6 | 97.5 | **123** |
| **iOS app** | 95 | 6 | 101 | **128** |
| **Android + iOS together** (one shared codebase) | 105.5 | 6 | 111.5 | **141** |
| **Web app** | 56 | 4 | 60 | **76** |
| **Complete system: API + Android + iOS + Web** | 254.5 | 10 | 269.5 | **≈ 341** |

**Notes**

- The Android and iOS apps are built with **Flutter**, so most of the code is shared. Ordering both costs 105.5 days of development, not 91.5 + 95. Building two separate native apps (Kotlin and Swift) would cost about 90 days each.
- The web estimate assumes it shares code with the mobile app. A web app on its own, without the mobile apps, is about 75 development days.
- The API is needed by every app and is included once.

**Suggested team and timeline for the complete system:** 2 backend engineers, 3 Flutter engineers, 1 QA engineer, plus a part-time designer and project manager. That is **about 4 months**: 2–3 weeks of discovery and design, about 12 weeks of development and testing, then store submission.

## 2. Feature-wise estimate per platform

Development days per module. "Mobile shared" is the common Flutter code used by both phone apps. "Android-specific" and "iOS-specific" are the native and store work for each platform.

| # | Module | API | Mobile shared (Android + iOS) | Android-specific | iOS-specific | Web |
|---|---|---:|---:|---:|---:|---:|
| 1 | Project setup & foundation | 14 | 9 | — | — | 6 |
| 2 | Authentication & access | 10.5 | 6 | 1 | 1.5 | 5 |
| 3 | Dashboard | 2 | 2.5 | — | — | 2.5 |
| 4 | Products & inventory | 12 | 12.5 | 1 | 1 | 8 |
| 5 | Customers | 4 | 5 | — | — | 3.5 |
| 6 | Sales | 11 | 11 | — | — | 6.5 |
| 7 | Documents & payments | 13 | 8.5 | 0.5 | 0.5 | 6.5 |
| 8 | Reports | 4 | 3.5 | — | — | 3.5 |
| 9 | Settings & team | 7 | 5 | — | — | 3.5 |
| 10 | Offline use (phones) | 3.5 | 9.5 | 0.5 | 0.5 | — |
| 11 | Localisation | — | 2 | — | — | 1 |
| 12 | Quality assurance | 6 | 6.5 | 4.5 | 4.5 | 8.5 |
| 13 | Deployment & release | 6 | — | 3 | 6 | 1.5 |
| | **Total development** | **93** | **81** | **10.5** | **14** | **56** |

- Android app = Mobile shared + Android-specific = 81 + 10.5 = **91.5 days**
- iOS app = Mobile shared + iOS-specific = 81 + 14 = **95 days**

## 3. Feature capability by platform

| Capability | API | Android | iOS | Web |
|---|:-:|:-:|:-:|:-:|
| Sign in, password reset, device management | ✔ | ✔ | ✔ | ✔ |
| Owner / Manager / Sales roles; cost hidden from Sales | ✔ | ✔ | ✔ | ✔ |
| Dashboard | ✔ | ✔ | ✔ | ✔ |
| Products, stock receiving, adjustments, history | ✔ | ✔ | ✔ | ✔ |
| Product photos | ✔ | ✔ camera / gallery | ✔ camera / gallery | ✔ file upload |
| Barcode | ✔ search | ✔ camera scan | ✔ camera scan | ✔ USB scanner |
| Customers | ✔ | ✔ | ✔ | ✔ |
| Sales: pricing, cart, discount, tax, payment | ✔ | ✔ | ✔ | ✔ |
| Quotations, invoices, payments, refunds | ✔ | ✔ | ✔ | ✔ |
| Cancellations, returns, credit notes | ✔ | ✔ | ✔ | ✔ |
| PDF documents | ✔ generates | ✔ share / WhatsApp | ✔ share / WhatsApp | ✔ view / print / download |
| Reports and CSV export | ✔ | ✔ | ✔ | ✔ |
| Settings, tax rates, team | ✔ | ✔ | ✔ | ✔ |
| Works offline | ✔ sync | ✔ | ✔ | Online only |
| App store distribution | — | Google Play | App Store | Web hosting |

## 4. API (backend) — 93 days

NestJS (Node.js) REST API with a PostgreSQL database and an OpenAPI contract. It serves the Android, iOS and web apps.

#### Project setup & foundation — 14 days

| Feature | What is included | Days |
|---|---|---:|
| Project scaffolding & pipelines | Code repositories, coding standards, automated build and test pipelines, dev / staging / production environments | 2 |
| Architecture & data model | Database design, API contract (OpenAPI), multi-business data separation | 4 |
| Security foundation | Row-level data isolation per business, rate limiting, security headers, audit log of sensitive actions | 5 |
| Core services | Error handling, request logging, duplicate-request protection, exact money arithmetic (no rounding drift) | 3 |

#### Authentication & access — 10.5 days

| Feature | What is included | Days |
|---|---|---:|
| Sign in | Email and password, account lockout after repeated failures | 2 |
| Sessions & secure storage | Short-lived access tokens with refresh; Android Keystore, iOS Keychain, secure browser cookies on web | 2 |
| Forgot / reset password | Email with a reset link that opens the app | 1.5 |
| Change password | Signs out other devices | 0.5 |
| Roles & permissions | Owner, Manager, Sales; purchase cost and profit hidden from Sales everywhere | 3 |
| Signed-in devices | List of own devices, sign out a lost device remotely | 1.5 |

#### Dashboard — 2 days

| Feature | What is included | Days |
|---|---|---:|
| Key figures | Today's sales vs yesterday, units in stock, money owed and overdue, month-to-date profit and inventory value (managers) | 1.5 |
| Needs attention & recent activity | Low / out-of-stock and overdue shortcuts into filtered lists, latest documents, quick actions | 0.5 |

#### Products & inventory — 12 days

| Feature | What is included | Days |
|---|---|---:|
| Product list | Search by name, SKU or barcode; In stock / Low / Out of stock filters with counts; sorting; paging | 2 |
| Product detail | Prices, stock, cost and margin (managers), recent movements | 0.5 |
| Add / edit / archive product | Validation, unique SKU, lowest / standard / highest selling price, reorder level | 2 |
| Product photos | Camera or gallery, upload to cloud storage, thumbnails, image caching | 3 |
| Barcode | Barcode field and search; camera scanning on phones; USB scanner on web | 0.5 |
| Receive stock | Purchase quantity and cost, supplier name, automatic average cost | 2 |
| Stock adjustments | Corrections with a mandatory reason | 1 |
| Stock history | Every movement with who, when and why | 1 |

#### Customers — 4 days

| Feature | What is included | Days |
|---|---|---:|
| Customer directory | Search by name, company, email or phone; paging | 1.5 |
| Add / edit customer | Phone number validation, duplicate check by mobile number, tax registration number, archive | 1.5 |
| Customer detail | Total invoiced, outstanding and overdue; the customer's documents | 1 |

#### Sales — 11 days

| Feature | What is included | Days |
|---|---|---:|
| Pricing engine | Allowed price range per product, discount, tax, live totals checked by the server; manager override below minimum with reason | 4 |
| Quotations | Numbered quotations with validity, cancel, convert to invoice | 3 |
| Invoice issue | Stock deducted, number assigned, first payment and audit recorded in one step; no overselling when two staff sell the last item | 4 |

#### Documents & payments — 13 days

| Feature | What is included | Days |
|---|---|---:|
| Documents list | Quotations and invoices together; status, date and salesperson filters; search | 2 |
| Invoice & quotation detail | Lines, totals, payments, balance, status (paid / partial / overdue / cancelled) | 0.5 |
| Later payments & refunds | Record instalments; manager refunds; overpayment blocked | 2 |
| Cancel invoice | Manager only; stock restored, received money recorded as refunded | 1.5 |
| Returns & credit notes | Return some items, optional restock, credit note issued | 3 |
| PDF documents | Branded invoice, quotation and credit-note PDFs with logo | 4 |

#### Reports — 4 days

| Feature | What is included | Days |
|---|---|---:|
| Sales summary | Revenue, cost, gross profit, tax, outstanding; Today / 7 days / month / custom range | 1.5 |
| Team & status reports | Sales by salesperson; paid / partial / unpaid / overdue breakdown | 1 |
| Inventory valuation | Stock value at cost and at selling price | 0.5 |
| CSV export | Invoices and stock for spreadsheets (managers) | 1 |

#### Settings & team — 7 days

| Feature | What is included | Days |
|---|---|---:|
| Business profile & settings | Name, address, tax number, currency, time zone, pricing limits, stock thresholds | 1.5 |
| Company logo | Upload; shown on documents | 1 |
| Tax rates | Add, rename, set default, retire | 1 |
| Team management | Invite by email, change role, remove or restore access; at least one owner always kept | 2 |
| Email delivery | Invitation and password-reset emails, sender domain set-up | 1.5 |

#### Offline use (phones) — 3.5 days

| Feature | What is included | Days |
|---|---|---:|
| Data saved on the device | Products and customers kept on the phone and updated in the background | 2.5 |
| Offline queue | Quotations, new customers and payments made offline are sent automatically when back online, exactly once; sync screen | 1 |

#### Quality assurance — 6 days

| Feature | What is included | Days |
|---|---|---:|
| Automated test suites | API integration and concurrency tests; app widget, flow and screenshot tests | 3 |
| Performance testing | Large data volumes (20k products, 100k invoices); start-up and list speed | 2 |
| User acceptance support | Fixes from client testing | 1 |

#### Deployment & release — 6 days

| Feature | What is included | Days |
|---|---|---:|
| Server deployment | Containers, HTTPS, database, automated backups and restore test | 4 |
| Monitoring & alerts | Error tracking, uptime checks, alerts | 2 |

## 5. Android and iOS apps — 105.5 days for both

One Flutter codebase produces both apps. Columns show the shared work and the work specific to each platform.

#### Project setup & foundation — 9 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Project scaffolding & pipelines | Code repositories, coding standards, automated build and test pipelines, dev / staging / production environments | 2 | — | — | 2 |
| Core services | Error handling, request logging, duplicate-request protection, exact money arithmetic (no rounding drift) | 2 | — | — | 2 |
| Design system | Colours, typography, light and dark themes, reusable components, accessibility contrast | 5 | — | — | 5 |

#### Authentication & access — 8.5 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Sign in | Email and password, account lockout after repeated failures | 1 | — | — | 1 |
| Sessions & secure storage | Short-lived access tokens with refresh; Android Keystore, iOS Keychain, secure browser cookies on web | 1.5 | 0.5 | 0.5 | 2.5 |
| Forgot / reset password | Email with a reset link that opens the app | 1 | 0.5 | 1 | 2.5 |
| Change password | Signs out other devices | 0.5 | — | — | 0.5 |
| Roles & permissions | Owner, Manager, Sales; purchase cost and profit hidden from Sales everywhere | 1 | — | — | 1 |
| Signed-in devices | List of own devices, sign out a lost device remotely | 1 | — | — | 1 |

#### Dashboard — 2.5 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Key figures | Today's sales vs yesterday, units in stock, money owed and overdue, month-to-date profit and inventory value (managers) | 1.5 | — | — | 1.5 |
| Needs attention & recent activity | Low / out-of-stock and overdue shortcuts into filtered lists, latest documents, quick actions | 1 | — | — | 1 |

#### Products & inventory — 14.5 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Product list | Search by name, SKU or barcode; In stock / Low / Out of stock filters with counts; sorting; paging | 2 | — | — | 2 |
| Product detail | Prices, stock, cost and margin (managers), recent movements | 1 | — | — | 1 |
| Add / edit / archive product | Validation, unique SKU, lowest / standard / highest selling price, reorder level | 2 | — | — | 2 |
| Product photos | Camera or gallery, upload to cloud storage, thumbnails, image caching | 2 | 0.5 | 0.5 | 3 |
| Barcode | Barcode field and search; camera scanning on phones; USB scanner on web | 2 | 0.5 | 0.5 | 3 |
| Receive stock | Purchase quantity and cost, supplier name, automatic average cost | 1.5 | — | — | 1.5 |
| Stock adjustments | Corrections with a mandatory reason | 1 | — | — | 1 |
| Stock history | Every movement with who, when and why | 1 | — | — | 1 |

#### Customers — 5 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Customer directory | Search by name, company, email or phone; paging | 1.5 | — | — | 1.5 |
| Add / edit customer | Phone number validation, duplicate check by mobile number, tax registration number, archive | 1.5 | — | — | 1.5 |
| Customer detail | Total invoiced, outstanding and overdue; the customer's documents | 1.5 | — | — | 1.5 |
| Contact actions | Call, WhatsApp and email from the customer page | 0.5 | — | — | 0.5 |

#### Sales — 11 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Pricing engine | Allowed price range per product, discount, tax, live totals checked by the server; manager override below minimum with reason | 1 | — | — | 1 |
| Product picker & price selection | Pick in-stock items, choose price within limits, quantity limited to stock | 2.5 | — | — | 2.5 |
| Cart | Edit quantities and prices, order discount, tax rate, notes; kept if the app is closed | 2.5 | — | — | 2.5 |
| Customer selection | Pick an existing customer or add one without leaving the sale | 0.5 | — | — | 0.5 |
| Payment | Full, partial or credit sale with due date; cash or bank transfer with reference; outcome shown before saving | 2 | — | — | 2 |
| Quotations | Numbered quotations with validity, cancel, convert to invoice | 1.5 | — | — | 1.5 |
| Invoice issue | Stock deducted, number assigned, first payment and audit recorded in one step; no overselling when two staff sell the last item | 1 | — | — | 1 |

#### Documents & payments — 9.5 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Documents list | Quotations and invoices together; status, date and salesperson filters; search | 2 | — | — | 2 |
| Invoice & quotation detail | Lines, totals, payments, balance, status (paid / partial / overdue / cancelled) | 2 | — | — | 2 |
| Later payments & refunds | Record instalments; manager refunds; overpayment blocked | 1.5 | — | — | 1.5 |
| Cancel invoice | Manager only; stock restored, received money recorded as refunded | 0.5 | — | — | 0.5 |
| Returns & credit notes | Return some items, optional restock, credit note issued | 1.5 | — | — | 1.5 |
| Share & print | Share PDF via share sheet and WhatsApp on phones; view, print and download on web | 1 | 0.5 | 0.5 | 2 |

#### Reports — 3.5 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Sales summary | Revenue, cost, gross profit, tax, outstanding; Today / 7 days / month / custom range | 1.5 | — | — | 1.5 |
| Team & status reports | Sales by salesperson; paid / partial / unpaid / overdue breakdown | 1 | — | — | 1 |
| Inventory valuation | Stock value at cost and at selling price | 0.5 | — | — | 0.5 |
| CSV export | Invoices and stock for spreadsheets (managers) | 0.5 | — | — | 0.5 |

#### Settings & team — 5 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Business profile & settings | Name, address, tax number, currency, time zone, pricing limits, stock thresholds | 1.5 | — | — | 1.5 |
| Company logo | Upload; shown on documents | 0.5 | — | — | 0.5 |
| Tax rates | Add, rename, set default, retire | 1 | — | — | 1 |
| Team management | Invite by email, change role, remove or restore access; at least one owner always kept | 1.5 | — | — | 1.5 |
| Appearance | Light, dark or same as device | 0.5 | — | — | 0.5 |

#### Offline use (phones) — 10.5 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Data saved on the device | Products and customers kept on the phone and updated in the background | 4 | 0.5 | 0.5 | 5 |
| Offline queue | Quotations, new customers and payments made offline are sent automatically when back online, exactly once; sync screen | 4 | — | — | 4 |
| Offline start-up | App opens without a connection; banner shows how fresh the data is | 1.5 | — | — | 1.5 |

#### Localisation — 2 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Translation-ready text | All text in translation files; local date, number and currency formats | 2 | — | — | 2 |

#### Quality assurance — 15.5 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Automated test suites | API integration and concurrency tests; app widget, flow and screenshot tests | 3 | — | — | 3 |
| Performance testing | Large data volumes (20k products, 100k invoices); start-up and list speed | 1 | — | — | 1 |
| Device / browser testing & fixes | Range of phones and tablets and OS versions; Chrome, Safari, Edge, Firefox | — | 4 | 4 | 8 |
| Accessibility | Screen readers, large text, contrast | 1.5 | — | — | 1.5 |
| User acceptance support | Fixes from client testing | 1 | 0.5 | 0.5 | 2 |

#### Deployment & release — 9 days

| Feature | What is included | Shared | Android | iOS | Total |
|---|---|---:|---:|---:|---:|
| Build variants & signing | Dev / staging / production builds; release signing | — | 1.5 | 2.5 | 4 |
| Store submission | Store listing, screenshots, privacy declarations, internal / TestFlight testing | — | 1 | 1.5 | 2.5 |
| Store review buffer | Responding to Google Play / App Store review feedback | — | 0.5 | 2 | 2.5 |

## 6. Web app — 56 days

A browser back office for owners, managers and counter staff at a desk. It uses large-screen layouts: sidebar navigation, sortable tables and side panels. It is built with Flutter Web, so it shares business logic with the mobile apps.

#### Project setup & foundation — 6 days

| Feature | What is included | Days |
|---|---|---:|
| Project scaffolding & pipelines | Code repositories, coding standards, automated build and test pipelines, dev / staging / production environments | 1 |
| Design system | Colours, typography, light and dark themes, reusable components, accessibility contrast | 2 |
| Desktop layout & navigation | Sidebar navigation, master-detail panels, data tables for large screens | 3 |

#### Authentication & access — 5 days

| Feature | What is included | Days |
|---|---|---:|
| Sign in | Email and password, account lockout after repeated failures | 1 |
| Sessions & secure storage | Short-lived access tokens with refresh; Android Keystore, iOS Keychain, secure browser cookies on web | 1.5 |
| Forgot / reset password | Email with a reset link that opens the app | 0.5 |
| Change password | Signs out other devices | 0.5 |
| Roles & permissions | Owner, Manager, Sales; purchase cost and profit hidden from Sales everywhere | 1 |
| Signed-in devices | List of own devices, sign out a lost device remotely | 0.5 |

#### Dashboard — 2.5 days

| Feature | What is included | Days |
|---|---|---:|
| Key figures | Today's sales vs yesterday, units in stock, money owed and overdue, month-to-date profit and inventory value (managers) | 1.5 |
| Needs attention & recent activity | Low / out-of-stock and overdue shortcuts into filtered lists, latest documents, quick actions | 1 |

#### Products & inventory — 8 days

| Feature | What is included | Days |
|---|---|---:|
| Product list | Search by name, SKU or barcode; In stock / Low / Out of stock filters with counts; sorting; paging | 2 |
| Product detail | Prices, stock, cost and margin (managers), recent movements | 1 |
| Add / edit / archive product | Validation, unique SKU, lowest / standard / highest selling price, reorder level | 1.5 |
| Product photos | Camera or gallery, upload to cloud storage, thumbnails, image caching | 1 |
| Barcode | Barcode field and search; camera scanning on phones; USB scanner on web | 0.5 |
| Receive stock | Purchase quantity and cost, supplier name, automatic average cost | 1 |
| Stock adjustments | Corrections with a mandatory reason | 0.5 |
| Stock history | Every movement with who, when and why | 0.5 |

#### Customers — 3.5 days

| Feature | What is included | Days |
|---|---|---:|
| Customer directory | Search by name, company, email or phone; paging | 1 |
| Add / edit customer | Phone number validation, duplicate check by mobile number, tax registration number, archive | 1 |
| Customer detail | Total invoiced, outstanding and overdue; the customer's documents | 1 |
| Contact actions | Call, WhatsApp and email from the customer page | 0.5 |

#### Sales — 6.5 days

| Feature | What is included | Days |
|---|---|---:|
| Pricing engine | Allowed price range per product, discount, tax, live totals checked by the server; manager override below minimum with reason | 0.5 |
| Product picker & price selection | Pick in-stock items, choose price within limits, quantity limited to stock | 1.5 |
| Cart | Edit quantities and prices, order discount, tax rate, notes; kept if the app is closed | 1.5 |
| Customer selection | Pick an existing customer or add one without leaving the sale | 0.5 |
| Payment | Full, partial or credit sale with due date; cash or bank transfer with reference; outcome shown before saving | 1 |
| Quotations | Numbered quotations with validity, cancel, convert to invoice | 1 |
| Invoice issue | Stock deducted, number assigned, first payment and audit recorded in one step; no overselling when two staff sell the last item | 0.5 |

#### Documents & payments — 6.5 days

| Feature | What is included | Days |
|---|---|---:|
| Documents list | Quotations and invoices together; status, date and salesperson filters; search | 1.5 |
| Invoice & quotation detail | Lines, totals, payments, balance, status (paid / partial / overdue / cancelled) | 1.5 |
| Later payments & refunds | Record instalments; manager refunds; overpayment blocked | 1 |
| Cancel invoice | Manager only; stock restored, received money recorded as refunded | 0.5 |
| Returns & credit notes | Return some items, optional restock, credit note issued | 1 |
| Share & print | Share PDF via share sheet and WhatsApp on phones; view, print and download on web | 1 |

#### Reports — 3.5 days

| Feature | What is included | Days |
|---|---|---:|
| Sales summary | Revenue, cost, gross profit, tax, outstanding; Today / 7 days / month / custom range | 1.5 |
| Team & status reports | Sales by salesperson; paid / partial / unpaid / overdue breakdown | 1 |
| Inventory valuation | Stock value at cost and at selling price | 0.5 |
| CSV export | Invoices and stock for spreadsheets (managers) | 0.5 |

#### Settings & team — 3.5 days

| Feature | What is included | Days |
|---|---|---:|
| Business profile & settings | Name, address, tax number, currency, time zone, pricing limits, stock thresholds | 1 |
| Company logo | Upload; shown on documents | 0.5 |
| Tax rates | Add, rename, set default, retire | 0.5 |
| Team management | Invite by email, change role, remove or restore access; at least one owner always kept | 1 |
| Appearance | Light, dark or same as device | 0.5 |

#### Localisation — 1 day

| Feature | What is included | Days |
|---|---|---:|
| Translation-ready text | All text in translation files; local date, number and currency formats | 1 |

#### Quality assurance — 8.5 days

| Feature | What is included | Days |
|---|---|---:|
| Automated test suites | API integration and concurrency tests; app widget, flow and screenshot tests | 1.5 |
| Performance testing | Large data volumes (20k products, 100k invoices); start-up and list speed | 1 |
| Device / browser testing & fixes | Range of phones and tablets and OS versions; Chrome, Safari, Edge, Firefox | 4 |
| Accessibility | Screen readers, large text, contrast | 1 |
| User acceptance support | Fixes from client testing | 1 |

#### Deployment & release — 1.5 days

| Feature | What is included | Days |
|---|---|---:|
| Web hosting | Hosting, caching, release pipeline | 1.5 |

## 7. Optional add-ons (not included above)

| Add-on | API | Mobile (Android + iOS) | Web | Total |
|---|---:|---:|---:|---:|
| Push notifications (low stock, overdue invoices) | 3 | 2 | — | 5 |
| Arabic language and right-to-left layout, Arabic PDFs | 1 | 8 | 4 | 13 |
| Invoices created offline (provisional, confirmed later) | 4 | 3 | — | 7 |
| Several saved carts / draft sales per user | 1 | 3 | 2 | 6 |
| Offline reading of documents and reports | — | 3 | — | 3 |
| Supplier directory and purchase orders | 7 | 6 | 4 | 17 |
| Multiple branches and stock transfers | 6 | 5 | 3 | 14 |
| Jewellery attributes (metal, purity, stones, gold-rate pricing) | 7 | 5 | 3 | 15 |
| Self sign-up, subscription plans and billing (SaaS) | 12 | 4 | 6 | 22 |

## 8. Assumptions

- English only at launch; all text is ready for translation.
- One tax rate per document, applied to the discounted total, tax-exclusive. A different tax scheme (per-line or tax-inclusive) adds 5–8 days.
- Average-cost stock valuation. Quantities are whole pieces.
- One branch per business in the user interface. The data model allows branches later.
- Payment methods: cash and bank transfer. No card terminal or payment-gateway integration.
- The client provides branding (logo, colours), invoice legal wording, and the store and hosting accounts.

## 9. Not included

- Hosting, store and third-party service fees: server, domain, email service, error monitoring, Apple Developer Program, Google Play Console.
- Product data entry, store listing text, and data migration from another system.
- Maintenance and support after launch. Usually quoted separately, typically 15–20% of build effort per year.
