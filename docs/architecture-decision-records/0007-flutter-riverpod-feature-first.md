# ADR-0007 — Flutter with Riverpod, go_router, Dio and Drift; feature-first structure

**Status:** Accepted (2026-11-15) · **Date:** 2026-11-15

## Decision
- Riverpod (generated providers) for state and dependency injection; go_router with a stateful shell for five tabs; Dio with auth, idempotency and error interceptors; Freezed/json_serializable models; Drift for cache, drafts and outbox; flutter_secure_storage for tokens.
- Feature folders with `data / domain / presentation`; a `domain` layer only where there is real logic or an offline abstraction. Shared code in `core/`. Design-system widgets and tokens are the only source of visual constants.
- Build flavours `dev`, `staging`, `prod` select configuration; no secrets in the binary.

## Consequences
- Code generation is part of the build (`build_runner`).
- Deliberately no generic use-case/interactor classes for simple reads — avoids ceremony.
- Alternatives: Bloc (more boilerplate for the same result here); Isar/Hive (weaker fit for relational cache + ordered queue).

## Addendum (2026-11-16, Sprint 6)

Two parts of this decision were not followed, deliberately:
- **Local database:** the `sqlite3` package is used directly instead of Drift. The offline store is four small tables with hand-written SQL; Drift would have added code generation for no query that needs it. If the local schema grows (document cache, migrations), revisit.
- **Models and providers** are hand-written rather than generated with Freezed / json_serializable / Riverpod generators. They are small, and avoiding `build_runner` keeps the build simple.
