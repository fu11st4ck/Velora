# Velora — Feature List and Effort Estimate

Prepared 2026-11-17 · Covers the **API**, the **Android** and **iOS** apps and a **Web** app.

## 1. Summary

| Client / component | Built with | Status today | v1 effort, total (PD) | v1 effort remaining (PD) | Optional extras (PD) |
|---|---|---|---:|---:|---:|
| API | NestJS · PostgreSQL | Features built and tested; not yet deployed | 94 | 12 | 7 |
| Mobile shared code (Android + iOS) | Flutter | Features built and tested; never run on a device | 82 | 12 | 14 |
| Android-specific work | Flutter / Gradle | Not started | 9.5 | 9.5 | 1 |
| iOS-specific work | Flutter / Xcode | Not started | 13 | 13 | 1 |
| Web app (back office) | Flutter Web (recommended) | Not started | 31 | 31 | — |
| **Engineering total** | | | **229.5** | **77.5** | **23** |

**Remaining work to launch v1 on all four clients**

| Item | PD |
|---|---:|
| Remaining engineering (table above) | 77.5 |
| Cross-platform regression and user acceptance testing | 8 |
| Project management and coordination (≈10%) | 8.5 |
| Contingency (20%) | 19 |
| **Total remaining** | **≈ 113 PD (≈ 5.4 person-months)** |

With a team of **one backend engineer, one Flutter engineer and a part-time QA engineer**, this is about **7–8 calendar weeks**. App Store and Play review times are not included, and neither is time spent waiting for the decisions in §8.

**How the numbers work**
- **PD (person-day)** = one experienced engineer's focused working day. It includes unit and integration tests and code review.
- **Total** = the effort a feature needs from scratch. For finished features it is an estimate of their size, not hours actually logged; the repository has no timesheets.
- **Remaining** = work still needed for v1, based on `TASKS.md` and the code as of commit `e2e0eb7`.
- Android and iOS share one Flutter codebase. The shared work is counted once (§4), and only native and store work is counted per platform (§5, §6).
- Items marked **Optional** (P2 or awaiting a decision) are kept out of the v1 totals.
- Priorities follow `docs/feature-matrix.md`: P0 = required for v1, P1 = v1 if time allows, P2 = after v1.

## 2. Features by client

| Capability | API | Android | iOS | Web |
|---|:-:|:-:|:-:|:-:|
| Sign in, password reset, session and device management | ✅ | ✅ | ✅ | 🆕 |
| Roles (Owner / Manager / Sales), cost hidden from Sales | ✅ | ✅ | ✅ | 🆕 |
| Dashboard | ✅ | ✅ | ✅ | 🆕 |
| Products, stock receipts, adjustments, stock history | ✅ | ✅ | ✅ | 🆕 |
| Product photos and company logo | 🔲 | 🔲 | 🔲 | 🆕 |
| Barcode search (typed) | ✅ | ✅ | ✅ | 🆕 |
| Barcode scanning | — | 🔲 camera | 🔲 camera | 🆕 USB scanner |
| Customers and customer picker | ✅ | ✅ | ✅ | 🆕 |
| Sell flow: price control, cart, discount, tax, payment | ✅ | ✅ | ✅ | 🆕 |
| Quotations, invoices, payments, refunds | ✅ | ✅ | ✅ | 🆕 |
| Cancellations, returns, credit notes | ✅ | ✅ | ✅ | 🆕 |
| PDFs and sharing (share sheet / WhatsApp) | ✅ | ✅ | ✅ | 🆕 download / print |
| Reports and CSV export | ✅ | ✅ | ✅ | 🆕 |
| Business settings, tax rates, team | ✅ | ✅ | ✅ | 🆕 |
| Works offline (saved data, queued changes) | ✅ | ✅ | ✅ | — online only |
| Push notifications | Optional | Optional | Optional | — |
| Store release | — | 🔲 | 🔲 | — |

✅ built and tested · 🔲 planned for v1, not built · 🆕 new web client · — not applicable

Mobile has "built and tested" status from unit, widget, golden-screenshot and live-API tests. **The app has never been built for or run on a phone**; that work is in §5 and §6.

## 3. API

43 REST paths under `/api/v1`; contract in `backend/openapi/openapi.yaml`.

| # | Feature | Scope | Priority | Total (PD) | Remaining (PD) | Status |
|---|---|---|---|---:|---:|---|
| 1 | Platform foundation | Config validation, request ids, error/response envelopes, security headers, rate limits, health probes, migrations, row-level security, append-only ledgers, money module, idempotency, audit log | P0 | 12 | 0 | Done |
| 2 | Authentication & sessions | Sign-in with lockout, rotating refresh tokens with reuse detection, sign-out, forgot/reset/change password, `/auth/me`, device sessions, remote sign-out, immediate revocation | P0 | 8 | 0 | Done |
| 3 | Roles & field policy | Owner / Manager / Sales permission map, deny-by-default routes, cost and profit stripped for Sales | P0 | 3 | 0 | Done |
| 4 | Business settings & tax rates | Profile, currency/time-zone lock, markup policy, thresholds; tax rates with exactly one default | P0 | 4 | 0 | Done |
| 5 | Team management | Invite by email with set-password link, change role, remove/restore access, last-owner protection | P1 | 4 | 0 | Done |
| 6 | Products | Search, stock filters, five sorts, keyset paging, counts, create with opening stock, edit with optimistic locking, archive | P0 | 6 | 0 | Done |
| 7 | Inventory | Receipts with weighted-average cost, adjustments with reason, movement ledger | P0 | 5 | 0 | Done |
| 8 | Product photos & company logo | Presigned upload to object storage, verification, re-encode, thumbnails, logo on PDFs | P1 | 4 | 4 | Not started |
| 9 | Customers | Search, mobile lookup (E.164), create (idempotent), detail with invoiced/outstanding/overdue, edit, archive | P0 | 4 | 0 | Done |
| 10 | Pricing engine | Price bounds, integer totals, discount, tax on discounted total, `/pricing/preview`, below-floor override with reason | P0 | 4 | 0 | Done |
| 11 | Quotations | Numbering, create, expiry, cancel, convert to invoice | P0 | 3 | 0 | Done |
| 12 | Invoices, payments & refunds | Single-transaction issue (stock, number, first payment, audit), later payments, refunds, no oversell under concurrency | P0 | 7 | 0 | Done |
| 13 | Cancellation, returns & credit notes | Full reversal with restock; returns with credit notes and optional restock | P1 | 5 | 0 | Done |
| 14 | Documents list & PDFs | Combined list with filters/search; invoice and quotation PDFs | P0 | 5 | 0 | Done |
| 15 | Credit-note PDF | PDF for `CN-…` documents (planned in S4-06, no endpoint yet) | P1 | 1 | 1 | Not started |
| 16 | Dashboard | Today vs yesterday, stock, owed/overdue, MTD profit, inventory value, needs-attention, recent documents | P0 | 2 | 0 | Done |
| 17 | Reports & CSV | Sales summary, by salesperson, status breakdown, inventory valuation, CSV exports with formula-injection guard | P0 | 4 | 0 | Done |
| 18 | Offline sync & maintenance | `/sync/changes` delta feed, consistency check, expiry purge | P1 | 4 | 0 | Done |
| 19 | Email delivery | SMTP provider set-up, sender domain (SPF/DKIM), invitation and reset templates checked end to end | P0 | 1 | 1 | Partly done (code done, no SMTP) |
| 20 | Deployment | Compose stack, Caddy HTTPS, backups and restore (done); first server run, staging environment | P0 | 4 | 2 | Partly done |
| 21 | Monitoring & alerts | Error-monitoring service, uptime checks, alert rules, log retention | P0 | 2 | 2 | Not started |
| 22 | Web-client support | Cookie-based session for browsers (httpOnly + CSRF), CORS allow-list, CSP for the web origin | P0 (if Web) | 2 | 2 | Not started |
| 23 | Provisional offline invoices (D8) | `offline` invoices from the outbox, conflict resolution queue | P2 | 4 | 4 | Optional |
| 24 | Push notifications | Low-stock and overdue alerts via FCM/APNs, device-token registry | P2 | 3 | 3 | Optional |
| | **Subtotal (v1, without optional)** | | | **94** | **12** | |
| | Optional items | | | 7 | 7 | |

The 2 PD for *Web-client support* is needed only if the web app is built.

## 4. Mobile shared code (Android + iOS, Flutter)

| # | Feature | Scope | Priority | Total (PD) | Remaining (PD) | Status |
|---|---|---|---|---:|---:|---|
| 1 | App foundation | Dev/staging/prod entry points, Riverpod, go_router with five tabs (rail on tablets), Dio client with single-flight refresh, secure token storage | P0 | 8 | 0 | Done |
| 2 | Design system | Light/dark themes, tokens, bundled fonts, shared components, contrast and golden tests | P0 | 6 | 0 | Done |
| 3 | Sign-in & session | Start-up/session restore, sign in, forgot/reset password, sign out | P0 | 3 | 0 | Done |
| 4 | Home dashboard | Role-aware KPIs, needs-attention links into filtered lists, recent documents | P0 | 3 | 0 | Done |
| 5 | Inventory screens (C1–C6) | List, detail, new/edit product, receive stock, adjust stock, stock history, live previews | P0 | 8 | 0 | Done |
| 6 | Product photos & logo | Camera/gallery picker, upload, image caching, logo in settings | P1 | 3 | 3 | Not started |
| 7 | Camera barcode scanning | Scan to search and to fill the product form | P1 | 3 | 3 | Not started |
| 8 | Customers (E1–E3) & picker | Directory, detail with call/WhatsApp/email, new/edit, duplicate check, picker for sales | P0 | 5 | 0 | Done |
| 9 | Customer's documents on detail | List of the customer's quotations and invoices | P1 | 1 | 1 | Not started |
| 10 | Sell flow (D1–D5) | Product picker, price sheet, cart kept across restarts, customer, payment outcome | P0 | 9 | 0 | Done |
| 11 | Documents (F1–F6) | List, invoice/quotation detail, record payment, cancel, return, share PDF, WhatsApp | P0 | 8 | 0 | Done |
| 12 | List refinements | Date/salesperson filter sheet for documents, infinite scroll in the sell picker | P1 | 2 | 2 | Not started |
| 13 | Reports | Period presets and custom range, status breakdown, team comparison, stock value, CSV export | P0 | 4 | 0 | Done |
| 14 | Settings, team & devices | Business settings, tax rates, team, signed-in devices, change password, appearance | P1 | 6 | 0 | Done |
| 15 | Offline & sync | On-device copy of products/customers, outbox for quotations/customers/payments, sync screen, offline start-up | P1 | 10 | 0 | Done |
| 16 | Localisation (English, ARB) | Extract strings to ARB files, date/number formats | P1 | 3 | 3 | Not started |
| 17 | Arabic / RTL | Translation, RTL layout pass, Arabic PDF fonts (needs U2 decision) | P2 | 8 | 8 | Optional |
| 18 | Named drafts (D6) | Several saved carts per user | P2 | 3 | 3 | Optional |
| 19 | Offline reading of documents & reports | Cache last-loaded documents and figures with a timestamp | P2 | 3 | 3 | Optional |
| | **Subtotal (v1, without optional)** | | | **82** | **12** | |
| | Optional items | | | 14 | 14 | |

## 5. Android-specific work

| # | Feature | Scope | Priority | Total (PD) | Remaining (PD) | Status |
|---|---|---|---|---:|---:|---|
| 1 | Build flavours | Gradle `productFlavors` for dev/staging/prod, app ids, icons per flavour | P0 | 1 | 1 | Not started |
| 2 | Deep links | `velora://` and App Links for password-reset/invite links | P0 | 0.5 | 0.5 | Not started |
| 3 | Device database verification | `sqlite3` build hooks and `path_provider` on device, exclude from backups | P0 | 1 | 1 | Not started |
| 4 | Permissions | Camera and photo access for scanning and product photos | P1 | 0.5 | 0.5 | Not started |
| 5 | Release signing & Play Console | Upload key, Play App Signing, internal testing track, CI release build | P0 | 1.5 | 1.5 | Not started |
| 6 | Store compliance & listing | Data-safety form, privacy policy link, screenshots, listing text | P0 | 1 | 1 | Not started |
| 7 | Device testing & fixes | Phones and a tablet across Android versions, low-end device performance, accessibility pass | P0 | 4 | 4 | Not started |
| 8 | Push notifications (FCM) | Only if push is built | P2 | 1 | 1 | Optional |
| | **Subtotal (v1, without optional)** | | | **9.5** | **9.5** | |
| | Optional items | | | 1 | 1 | |

## 6. iOS-specific work

Needs macOS: a Mac or a macOS CI runner, plus an Apple Developer account.

| # | Feature | Scope | Priority | Total (PD) | Remaining (PD) | Status |
|---|---|---|---|---:|---:|---|
| 1 | Build schemes | Xcode schemes/configurations for dev/staging/prod, bundle ids, icons | P0 | 1.5 | 1.5 | Not started |
| 2 | Universal links | Associated domains + `velora://` for reset/invite links | P0 | 1 | 1 | Not started |
| 3 | Device database verification | `sqlite3` on device, file protection, exclude from iCloud backup | P0 | 1 | 1 | Not started |
| 4 | Permissions | Camera and photo-library usage strings | P1 | 0.5 | 0.5 | Not started |
| 5 | Signing & TestFlight | Certificates, provisioning, CI on a macOS runner, TestFlight distribution | P0 | 2 | 2 | Not started |
| 6 | Store compliance & listing | Privacy manifest, App Store privacy labels, screenshots, review notes with demo account | P0 | 1 | 1 | Not started |
| 7 | Device testing & fixes | iPhones and an iPad across iOS versions, accessibility (VoiceOver, Dynamic Type) | P0 | 4 | 4 | Not started |
| 8 | App Review buffer | Responding to review feedback and resubmission | P0 | 2 | 2 | Not started |
| 9 | Push notifications (APNs) | Only if push is built | P2 | 1 | 1 | Optional |
| | **Subtotal (v1, without optional)** | | | **13** | **13** | |
| | Optional items | | | 1 | 1 | |

## 7. Web app

**Recommended: Flutter Web, as a back office for owners and managers at a desk.** About 70% of the mobile code carries over: models, API client, business logic, money maths and theme. The new work is the desktop layouts and the browser-specific pieces. The web app is online-only; offline use stays a mobile feature.

| # | Feature | Scope | Priority | Total (PD) | Remaining (PD) | Status |
|---|---|---|---|---:|---:|---|
| 1 | Web target & hosting | Flutter web build, served by the existing Caddy, caching headers, CI job | P0 | 2 | 2 | Not started |
| 2 | Desktop UX design | Wide layouts: sidebar navigation, master-detail, data tables (designs for 8–10 screens) | P0 | 5 | 5 | Not started |
| 3 | Browser session handling | Cookie session instead of Keychain/Keystore tokens, idle timeout, sign-out on all tabs | P0 | 3 | 3 | Not started |
| 4 | Responsive back-office screens | Inventory, documents, customers, reports and settings as sortable tables with paging and side panels | P0 | 10 | 10 | Not started |
| 5 | Sell flow on desktop | Keyboard-friendly product search and cart; USB barcode scanner (keyboard input) | P1 | 3 | 3 | Not started |
| 6 | PDF & CSV in the browser | View/print invoices in a tab, download PDF and CSV | P0 | 2 | 2 | Not started |
| 7 | Online-only mode | Disable the on-device database and outbox on web; clear offline messaging | P0 | 2 | 2 | Not started |
| 8 | Browser testing | Chrome, Safari, Edge, Firefox; accessibility; first-load performance | P0 | 4 | 4 | Not started |
| | **Subtotal (v1, without optional)** | | | **31** | **31** | |

**Alternative: a separate React / Next.js app.** This means rebuilding every screen, the API client, money formatting and role handling: **about 65 PD**, plus a second UI codebase to maintain for good. Choose it only if the web app needs SEO, a public storefront, or a team that has web skills but not Flutter.

## 8. Decisions and dependencies affecting the estimate

| # | Open item | Affects | Effect if decided differently |
|---|---|---|---|
| D11 / U3 | Server, domain, SMTP account, off-server backup target, error-monitoring vendor | API deployment, email, monitoring | Blocks launch; no change in effort |
| — | Apple and Google developer accounts | Android, iOS | Blocks store release |
| D7 | Accountant to confirm the tax rule (one exclusive rate on the discounted total) | API, all clients | Per-line or tax-inclusive pricing: +5–8 PD |
| U2 | Arabic / right-to-left support | Mobile, Web, PDFs | +8 PD mobile, +4 PD web |
| U1 | Single business or a product sold to many (self sign-up, billing) | API, Web | Sign-up, plans and billing: +15–25 PD |
| D5 | Jewellery attributes (metal, purity, stones, gold-rate pricing) | API, all clients | +10–20 PD depending on whether pricing changes |
| D6 | Supplier directory and purchase orders | API, all clients | +12–18 PD |
| D9 | Multi-branch UI and stock transfers | API, all clients | +10–15 PD |

## 9. Suggested delivery order

1. **Weeks 1–2 — Go live on Android.** First server deployment, SMTP and monitoring (API). Android flavours, signing, device testing, Play internal testing. Localisation extraction.
2. **Weeks 2–4 — iOS and remaining mobile features.** iOS schemes, signing, TestFlight, device testing. Product photos and logo (API + app). Camera barcode scanning. Credit-note PDF. List refinements.
3. **Weeks 3–7 — Web back office.** Cookie sessions and CORS (API). Desktop design, back-office screens, browser testing.
4. **Weeks 7–8 — Release.** Cross-platform regression, user acceptance, store submissions, web launch.
