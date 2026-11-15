# ADR-0003 — Money as integer minor units; rates as basis points; half-up rounding

**Status:** Proposed · **Date:** 2026-11-15

## Context
The reference computes money in JavaScript floating point and displays zero decimals, so a document can show a total that its own lines do not add up to (VAT 141.95 shown as "AED 142").

## Decision
- Money is an integer count of the currency's minor unit everywhere: `BIGINT` in PostgreSQL, `bigint` in TypeScript domain code, `int` in Dart, JSON integers on the wire (field suffix `Minor`).
- Percentages are integer basis points (suffix `Bp`).
- All divisions round half up, once, at the steps defined in `business-rules.md`. Allocation uses the largest-remainder method so parts always sum to the whole.
- Currency code and exponent are organization settings.

## Consequences
- No rounding drift; totals are reproducible on server and client.
- Markup has 0.01% resolution; weight is the only decimal type (`NUMERIC`, not money).
- JSON integers are safe to 2^53; document totals are validated to stay below that.
- A decimal library/`NUMERIC` was considered: equally exact but easier to misuse (implicit scale, float conversion at boundaries).
