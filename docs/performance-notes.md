# Velora — Performance Notes

Measured 2026-11-16 on the development container (single PostgreSQL 16 instance and one API process on the same machine, no network latency), with one organization holding **20,000 products, 20,000 customers, 100,000 invoices and 66,000 payments**. Times are full HTTP round trips for the third of three consecutive requests. They show where the time goes; they are not a capacity claim for production hardware.

| Request | Time |
|---|---|
| Products: list (25), search, low-stock filter with counts | 45–70 ms |
| Products the sales role can sell, searched (50) | 65–80 ms |
| Customers: list, search by phone digits, search by name | 25 ms |
| Documents: newest 25 (manager / own for sales) | 10 ms |
| Documents: unpaid and partial | 10 ms |
| Documents: search by number or customer | 20–150 ms |
| Dashboard (manager / sales) | 340 ms / 155 ms |
| Sales summary, by salesperson, payment status — 30 days | 110–270 ms |
| Inventory valuation (25 of 20,000) | 55 ms |
| Sync snapshot, 500 products and 500 customers | 100 ms |

## What was changed

- **Documents list** took 1.1 s: it sorted every invoice and quotation by a computed value and counted the lines of each before taking 25. Each kind now takes its newest page directly from the `(organization_id, issued_at)` index, the two short lists are merged, and lines are counted for the page only. The cursor is compared as a timestamp so the same index serves later pages. → 10 ms.
- Every authenticated request now makes one extra indexed lookup (is the session still open). Measured cost: below 1 ms.

## Known costs, accepted for now

- **Dashboard for a manager (340 ms)** runs the month-to-date profit aggregation on every load. If it becomes noticeable on production hardware, cache it for a minute per organization.
- **Document search (up to 150 ms)** matches number, customer name and company with `ILIKE` over the organization's documents. A trigram index on the snapshot name columns would remove the scan.
- **Sync** computes "changed since" from the product row, its stock and the organization settings, so it scans the organization's products rather than using the `updated_at` index alone. At 20,000 products a delta call takes about 60 ms.
- Reports scan the invoices of the chosen period; a year of 100,000 invoices takes roughly a second. The period is capped at 366 days.

## Not measured

Start-up time, list scrolling and memory on a phone — these need a device. Concurrent load (many users at once) — needs a load generator against deployed hardware.
