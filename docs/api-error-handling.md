# Velora — API Error Handling

## 1. Error envelope

Every non-2xx response has this body and `Content-Type: application/json`:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Not enough stock for 1 item.",
    "details": [
      { "lineNo": 2, "productId": "0193a4c0-7b1e-7c3a-9a55-3f1f0c2d9e04", "field": "lines[1].quantity",
        "requested": 5, "available": 2 }
    ],
    "requestId": "req_01JCXK3V7M"
  }
}
```

| Field | Contract |
|---|---|
| `code` | Stable, machine-readable, `UPPER_SNAKE`. The app switches on this — never on `message`. |
| `message` | English, safe to show, no internal detail. The app prefers its own localized text keyed by `code`. |
| `details` | Optional array. For validation errors each entry has `field` (JSON path) and `rule`; for business errors, the numbers the user needs to fix the problem. |
| `requestId` | Echoed from `X-Request-Id` (generated if absent); shown in the app's error sheet and attached to error-monitoring events. |

Stack traces, SQL, and internal identifiers are never returned. Unknown exceptions are logged with full context and returned as `500 INTERNAL_ERROR`.

## 2. Status code policy

| Status | Meaning | Client behaviour |
|---|---|---|
| 400 | Malformed request: bad JSON, wrong types, unknown fields, DTO validation (`VALIDATION_ERROR`) | Developer error or form error; map `details[].field` to inputs |
| 401 | Missing/expired/invalid credentials | `TOKEN_EXPIRED` → refresh and replay once; others → sign in |
| 403 | Authenticated but not permitted | Show "You don't have access"; never retry |
| 404 | Not found **or belongs to another tenant** (indistinguishable by design) | Remove from local cache |
| 409 | State conflict: the request was valid but the world changed | Refresh data, show the specific conflict, let the user decide |
| 422 | Business rule violated by the request's content | Show next to the offending input |
| 429 | Rate limited | Wait `Retry-After` seconds, then retry |
| 500 | Bug | Show generic error with request id; retry only if idempotent |
| 502/503/504 | Unavailable | Retry with backoff; queue if the operation is offline-capable |

## 3. Error catalogue

### Authentication and access
| Code | Status | When |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Wrong email or password (not distinguished) |
| `TOKEN_EXPIRED` | 401 | Access token expired |
| `TOKEN_INVALID` | 401 | Malformed or wrongly signed token |
| `SESSION_REVOKED` | 401 | Refresh token unknown, expired, revoked or reused |
| `ACCOUNT_DISABLED` | 403 | User or membership deactivated |
| `FORBIDDEN` | 403 | Role lacks permission |
| `TOO_MANY_ATTEMPTS` | 429 | Login/reset throttled |
| `RATE_LIMITED` | 429 | General rate limit |
| `RESET_TOKEN_INVALID` | 422 | Reset link expired or used |
| `CURRENT_PASSWORD_INCORRECT` | 422 | Change-password check failed |
| `WEAK_PASSWORD` | 422 | Password policy not met (`details[].rule`) |

### Generic
| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | DTO validation failed |
| `NOT_FOUND` | 404 | Resource missing or in another tenant |
| `VERSION_CONFLICT` | 409 | Optimistic lock failed (`details.currentVersion`) |
| `INVALID_STATE` | 409 | Action not allowed in the resource's current state (`details.state`) |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Header missing on a ⟳ endpoint |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key, different request body |
| `REQUEST_IN_PROGRESS` | 409 | Same key is still being processed; retry shortly |
| `INTERNAL_ERROR` | 500 | Unhandled |
| `SERVICE_UNAVAILABLE` | 503 | Dependency down |

### Catalog and inventory
| Code | Status | When |
|---|---|---|
| `SKU_TAKEN` / `BARCODE_TAKEN` | 409 | Uniqueness within the organization |
| `MARKUP_POLICY_INVALID` | 422 | Not `0 ≤ min ≤ default ≤ max` |
| `PRODUCT_HAS_STOCK` | 409 | Archive with stock on hand |
| `PRODUCT_ARCHIVED` | 422 | Receipt/adjustment on an archived product |
| `INSUFFICIENT_STOCK` | 409 | Sale or out-adjustment exceeds on-hand |
| `IMAGE_INVALID` | 422 | Uploaded object missing, too large or wrong type |

### Sales, payments, returns
| Code | Status | When |
|---|---|---|
| `PRODUCT_UNAVAILABLE` | 422 | Line product archived/inactive |
| `PRICE_BELOW_MINIMUM` | 422 | Unit price under the floor without a permitted override (`details.floorPriceMinor`) |
| `PRICE_ABOVE_MAXIMUM` | 422 | Unit price over the ceiling (`details.ceilingPriceMinor`) |
| `DISCOUNT_EXCEEDS_SUBTOTAL` | 422 | Discount > subtotal |
| `TAX_RATE_INACTIVE` | 422 | Chosen tax rate deactivated |
| `CUSTOMER_ARCHIVED` | 422 | Document for an archived customer |
| `QUOTATION_ALREADY_CONVERTED` | 409 | Second conversion attempt (`details.invoiceId`) |
| `PAYMENT_EXCEEDS_BALANCE` | 422 | Amount > balance (`details.balanceMinor`) |
| `INVOICE_ALREADY_PAID` | 422 | Payment on a zero-balance invoice |
| `INVOICE_CANCELLED` | 409 | Any mutation on a cancelled invoice |
| `INVOICE_HAS_RETURNS` | 409 | Cancel attempted after a return |
| `REFUND_EXCEEDS_PAID` | 422 | Refund > amount received |
| `REFUND_METHOD_REQUIRED` | 422 | Money must go back and no method was given |
| `RETURN_QUANTITY_EXCEEDS_SOLD` | 422 | Return more than remains returnable |
| `OFFLINE_SALES_DISABLED` | 422 | Offline-flagged invoice while the setting is off |

### Organization
| Code | Status | When |
|---|---|---|
| `SETTING_LOCKED` | 409 | Currency/timezone change after documents exist |
| `MEMBER_EXISTS` | 409 | Email already a member |
| `LAST_OWNER` | 409 | Would leave the organization without an owner |
| `DUPLICATE_NAME` | 409 | Tax-rate name in use |
| `DEFAULT_RATE_REQUIRED` | 409 | Deactivating the default tax rate |

## 4. Server implementation

- One global exception filter converts everything to the envelope.
- Domain code throws typed `DomainError(code, status, details)`; controllers never build error responses by hand.
- `class-validator` failures → `VALIDATION_ERROR` with one `details` entry per constraint.
- Prisma errors are mapped centrally: unique violation → the specific `*_TAKEN` code by constraint name; foreign-key violation → `NOT_FOUND` or `INVALID_STATE`; check violation → `INTERNAL_ERROR` **and an alert** (a constraint firing means service validation has a gap).
- Deadlock / serialization failures are retried (max 3) before surfacing `SERVICE_UNAVAILABLE`.
- Every error is logged once with `requestId`, user, organization, route, code; 5xx are also sent to error monitoring.

## 5. Client implementation (Flutter)

- A Dio interceptor maps responses to a sealed `Failure`: `NetworkFailure`, `TimeoutFailure`, `UnauthorizedFailure`, `ForbiddenFailure`, `NotFoundFailure`, `ValidationFailure(fields)`, `BusinessFailure(code, details)`, `ConflictFailure(code, details)`, `RateLimitedFailure(retryAfter)`, `ServerFailure(requestId)`.
- `core/errors/error_messages.dart` maps `code` → localized message; unknown codes fall back to the server `message`, then to a generic text.
- Presentation rules: field errors inline; business/conflict errors in a sheet that states what happened and what to do; network errors as a banner with Retry; nothing is swallowed.
- Retry policy: `GET` — up to 3 attempts with exponential backoff and jitter on network/5xx. ⟳ `POST` — retried with the **same** idempotency key. Other mutations are not retried automatically.
- `REQUEST_IN_PROGRESS` → retry after 1 s, 2 s, 4 s with the same key.

## 6. Idempotency behaviour in detail

1. First request with a key: a row is inserted (`response_status = null`) in the same transaction as the business change; the response is stored on commit.
2. Replay after completion: stored status and body are returned with `Idempotent-Replayed: true`.
3. Replay while in flight: `409 REQUEST_IN_PROGRESS`.
4. Same key with a different body hash: `409 IDEMPOTENCY_KEY_REUSED`.
5. A request that failed with 4xx stores that failure too — the same key always yields the same outcome. To try again after correcting input, the client generates a new key.
6. Failures from 5xx/transaction rollback store nothing, so the retry executes normally.
