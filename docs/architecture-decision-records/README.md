# Architecture Decision Records

One file per decision: context, decision, consequences. Status is `Proposed` until the Sprint 0 review, then `Accepted`. Superseded records are kept and linked.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-server-authoritative-backend.md) | Build a server-authoritative backend; the reference's local storage model is not carried over | Proposed |
| [0002](0002-modular-monolith-nestjs-postgres.md) | Modular monolith on NestJS/Fastify, PostgreSQL, Prisma; no Redis in v1 | Proposed |
| [0003](0003-money-as-integer-minor-units.md) | Money as integer minor units, rates as basis points, half-up rounding | Proposed |
| [0004](0004-multi-tenancy-shared-schema-rls.md) | Shared-schema multi-tenancy with row-level security | Proposed |
| [0005](0005-fixed-roles-and-field-policy.md) | Three fixed roles and server-side field confidentiality | Proposed |
| [0006](0006-append-only-ledgers.md) | Append-only stock and payment ledgers; invoices are immutable | Proposed |
| [0007](0007-flutter-riverpod-feature-first.md) | Flutter with Riverpod, go_router, Dio, Drift; feature-first structure | Proposed |
| [0008](0008-offline-outbox-server-confirmed.md) | Offline via cache + outbox; stock and money confirmed by the server | Proposed |
| [0009](0009-invoice-is-the-sale.md) | An invoice is the sale; quotations are separate; payments attach to one invoice | Proposed |
