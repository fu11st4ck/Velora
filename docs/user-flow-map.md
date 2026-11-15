# Velora — User Flow Map

Two kinds of diagram appear here:

- **Reference (as-is):** what the web demo does today, verified in the audit.
- **Target (mobile):** the flow the Flutter app and API will implement. Differences are deliberate and explained in [`design-audit.md`](design-audit.md) and [`product-discovery.md`](product-discovery.md).

## 1. Navigation

### Reference (as-is)

```mermaid
flowchart LR
  Home[Overview] -->|Browse inventory / Review low stock| Inv[Inventory]
  Home -->|Add new stock - manager| Add[[Add inventory modal]]
  Home -->|Start a customer sale| Sale[New sale]
  Home -.->|View all - dead button| X((nothing))
  Inv -->|tap card| Price[[Price this item modal]]
  Sale -->|Set price| Price
  Price -->|Add to cart| CartBtn([Cart button])
  CartBtn --> Cart[[Cart drawer]]
  Cart -->|Save quotation| Doc[[Document view]]
  Cart -->|Proceed to invoice| Pay[[Record payment modal]]
  Pay -->|Generate final invoice| Doc
  Docs[Invoices] -->|View| Doc
  Reports[Reports - desktop only]
```

### Target (mobile)

```mermaid
flowchart TB
  Login --> Shell
  subgraph Shell[Bottom navigation]
    Home
    Inventory
    Sell
    Documents
    More
  end
  Home --> ProductDetail
  Home --> DocumentDetail
  Home -->|Low stock card| Inventory
  Inventory --> ProductDetail[Product detail]
  ProductDetail --> EditProduct[Edit product]
  ProductDetail --> ReceiveStock[Receive stock]
  ProductDetail --> AdjustStock[Adjust stock]
  ProductDetail --> Movements[Stock history]
  ProductDetail -->|Sell| PriceSheet
  Inventory -->|FAB - manager| NewProduct[New product]
  Sell -->|tap / scan| PriceSheet[Price sheet]
  PriceSheet --> Cart
  Cart --> CustomerPicker[Customer picker / new]
  Cart --> Review[Review and totals]
  Review -->|Save quotation| DocumentDetail
  Review -->|Take payment| Payment
  Payment --> DocumentDetail[Document detail]
  Documents --> DocumentDetail
  DocumentDetail --> RecordPayment[Record payment]
  DocumentDetail --> Convert[Convert quotation]
  DocumentDetail --> Cancel[Cancel invoice]
  DocumentDetail --> Return[Return items]
  DocumentDetail --> Share[Share PDF / WhatsApp]
  More --> Reports
  More --> Customers
  More --> Settings
  Customers --> CustomerDetail[Customer detail and statement]
```

## 2. Inventory management

### Reference (as-is)

```mermaid
flowchart TD
  A[Manager opens Add inventory] --> B[Fill name, weight, description, qty, cost, default %, min %]
  B --> C{Required fields present?}
  C -- no --> B
  C -- yes --> D[New product always created - duplicate SKU allowed, min % may exceed default %]
  D --> E[Toast, product at top of list]
  E --> F[No way to edit, restock, adjust or view history]
```

### Target

```mermaid
flowchart TD
  S[Inventory list] --> Q{What changed?}
  Q -- New item --> N[New product form] --> NV{Valid? SKU unique, min <= default <= max}
  NV -- no --> N
  NV -- yes --> NC[Create product + OPENING / PURCHASE_RECEIPT movement in one transaction]
  Q -- More of an existing item --> R[Receive stock: qty, unit cost, supplier name, note]
  R --> RC[Movement PURCHASE_RECEIPT; quantity up; cost = weighted average]
  Q -- Count is wrong / damage / loss --> J[Adjust stock: +/- qty, mandatory reason]
  J --> JV{Would stock go negative?}
  JV -- yes --> JE[Reject: insufficient stock]
  JV -- no --> JC[Movement ADJUSTMENT_IN / OUT]
  NC --> H[Stock history shows every movement with user, time, document]
  RC --> H
  JC --> H
  H --> L{qty <= reorder level?}
  L -- yes --> LS[Appears in Low stock; qty 0 = Out of stock]
```

## 3. Sale → quotation or invoice

### Reference (as-is)

```mermaid
flowchart TD
  A[New sale or Inventory] --> B[Set price: markup slider min..60, qty 1..stock]
  B --> C[Add to cart - line keyed by product + markup]
  C --> D[Open cart: type customer, discount, VAT 0/5]
  D --> E{Name or company filled and cart not empty?}
  E -- no --> D
  E -- Save quotation --> Q[Quotation created; cart kept; drawer state lost]
  E -- Proceed to invoice --> P[Payment modal]
  P --> F[Generate final invoice]
  F --> G[Stock = max 0, stock - sold : oversell silently clamped]
  G --> H[Document view: print / WhatsApp text]
```

### Target

```mermaid
flowchart TD
  A[Sell tab: search or scan] --> B[Price sheet: price within floor..ceiling, qty <= available minus already in cart]
  B --> C[Cart - persisted locally as a draft]
  C --> D[Pick existing customer or create new]
  D --> E[Review: discount 0..subtotal, tax rate from settings]
  E --> PV[Server price preview returns authoritative totals]
  PV --> K{Choose}
  K -- Save quotation --> Q[POST /quotations - idempotent]
  Q --> QD[Quotation OPEN, numbered, no stock change, valid until date]
  K -- Take payment --> P[Payment: amount now 0..total, method, terms]
  P --> I[POST /invoices - idempotent, one DB transaction]
  I --> V{All lines in stock?}
  V -- no --> ERR[409 INSUFFICIENT_STOCK listing lines; cart kept; user fixes quantities]
  V -- yes --> T[Number allocated, stock deducted, SALE movements, payment recorded, audit log]
  T --> DOC[Invoice detail: PDF, share, record payment]
  QD -->|later| CV[Convert to invoice: re-validates stock and price floors] --> P
```

## 4. Payments and outstanding balances

Reference: payment is captured once at invoice creation and can never be added to. Target:

```mermaid
stateDiagram-v2
  [*] --> UNPAID: issued, nothing received (credit sale)
  [*] --> PARTIAL: issued with part payment
  [*] --> PAID: issued with full payment
  UNPAID --> PARTIAL: payment < balance
  UNPAID --> PAID: payment = balance
  PARTIAL --> PAID: payment = balance
  PARTIAL --> PARTIAL: payment < balance
  PAID --> PARTIAL: refund without return (correction)
  UNPAID --> CANCELLED: cancel (no payments)
  PARTIAL --> CANCELLED: cancel (payments refunded first)
  PAID --> CANCELLED: cancel (payments refunded first)
  CANCELLED --> [*]
  note right of UNPAID
    Overdue is derived, not stored:
    balance > 0 and due date < today
    (organization timezone)
  end note
```

```mermaid
sequenceDiagram
  actor U as Staff
  participant App
  participant API
  participant DB
  U->>App: Record payment (amount, method, reference)
  App->>API: POST /invoices/{id}/payments + Idempotency-Key
  API->>DB: BEGIN and lock invoice row
  API->>DB: check ISSUED, 0 < amount <= balance
  API->>DB: insert payment, update paid_minor and payment_status, audit log
  API->>DB: COMMIT
  API-->>App: 201 payment + updated invoice
  Note over App,API: Retry with the same key returns the stored 201 — no second payment
```

## 5. Cancellation and returns (new — not in the reference)

```mermaid
flowchart TD
  A[Invoice detail - manager] --> B{Action}
  B -- Cancel whole invoice --> C{Has returns?}
  C -- yes --> CE[Reject: use returns]
  C -- no --> C1[Reason required]
  C1 --> C2[One transaction: REFUND rows for money received, SALE_CANCELLATION movements restore stock, status CANCELLED, audit]
  B -- Return items --> R1[Pick lines and qty <= sold minus already returned; reason; restock yes/no per line]
  R1 --> R2[Credit note numbered; amount = line net of allocated discount + its tax]
  R2 --> R3[CUSTOMER_RETURN movement for restocked lines]
  R3 --> R4{Credit > remaining balance?}
  R4 -- yes --> R5[Record REFUND for the excess with method]
  R4 -- no --> R6[Balance reduced]
```

## 6. Authentication

```mermaid
sequenceDiagram
  participant App
  participant API
  App->>API: POST /auth/login (email, password, device)
  API-->>App: access token (15 min) + refresh token (30 d, single use)
  App->>App: store both in Keychain / Keystore
  App->>API: request with expired access token
  API-->>App: 401 TOKEN_EXPIRED
  App->>API: POST /auth/refresh (single flight)
  alt refresh valid
    API-->>App: new access + new refresh (old one marked rotated)
    App->>API: replay original request
  else refresh reused, expired or revoked
    API-->>App: 401 SESSION_REVOKED (whole token family revoked)
    App->>App: keep local drafts, show login
  end
```

## 7. Offline sale synchronization

```mermaid
flowchart TD
  A[Action while offline] --> B{Type}
  B -- Browse catalog, customers, documents --> C[Served from local cache with 'as of' time]
  B -- Build cart / draft --> D[Saved locally]
  B -- Quotation, new customer --> E[Queued with client UUID + idempotency key; shown as Pending sync]
  B -- Invoice --> F{Org setting allow_offline_sales}
  F -- off --> G[Blocked with explanation; draft kept]
  F -- on --> H[Queued as provisional invoice, no number; receipt marked Provisional]
  B -- Stock receipt, adjustment, cancel, return, product edit --> I[Requires connection]
  E --> S[Connectivity returns: queue replays in order]
  H --> S
  S --> R{Server result}
  R -- 2xx --> OK[Local record replaced by server record with real number]
  R -- 409 stock / 422 validation --> NA[Marked Needs attention; nothing altered silently; user edits and resubmits or discards]
  R -- 401 --> AU[Pause queue; re-login; resume]
  R -- network / 5xx --> RT[Retry with backoff, same idempotency key]
```
