# Milestones

## v3.0 Fuzzy Search (Shipped: 2026-03-12)

**Phases:** 10-12 (3 phases, 4 plans)
**Timeline:** 1 day (2026-03-12)
**Commits:** 30 | **Files changed:** 39 (+5,201 / -905)
**Git range:** 84ed80e → 9d20551

**Delivered:** MCP search tools made resilient to accent variations, spacing differences, and fuzzy spelling — venues get DB-level trigram matching via two-pass strategy, events and performers get lightweight accent normalization.

**Key accomplishments:**
- PostgreSQL pg_trgm + unaccent extensions with IMMUTABLE f_unaccent wrapper and GIN trigram index
- search_venues_fuzzy RPC with word_similarity matching and configurable threshold
- Zero-dependency normalizeQuery() and stripAccents() TypeScript utility
- Two-pass venue search: exact/normalized first, fuzzy RPC fallback on zero results
- Accent-normalized event and performer search using two-needle pattern
- 31 new tests across all 3 phases (106 total)

### Known Gaps
- **NORM-03** (partial): Number-word equivalence ("1oak" → "oneoak") deliberately narrowed to digits-preserved. Fuzzy RPC provides partial safety net for venues.

---

## v2.0 VIP Dashboard Migration (Shipped: 2026-03-12)

**Phases:** 6-9 (4 phases, 7 plans, 14 tasks)
**Timeline:** 1 day (2026-03-11 → 2026-03-12)
**Commits:** 28 | **Files changed:** 48 (+7,386 / -4,108)
**Git range:** a269c52 → c7a41b4

**Delivered:** VIP booking admin dashboard migrated from nightlife-mcp Express to nlt-admin Next.js with full feature parity plus Stripe/Resend side effects, then Express admin code surgically removed.

**Key accomplishments:**
- Full read-only VIP booking dashboard in nlt-admin with paginated list, 4-type filter bar, status badges, and 60s auto-refresh
- VIP booking detail page with status timeline, edit audit log, and agent task indicators
- Admin booking creation with 4-level pricing lookup and ops traceability
- Full status pipeline with Stripe deposit creation and Resend email dispatch as non-blocking side effects
- Status update UI with valid transition map, default messages, and deposit link display
- Clean removal of 3,167 lines of Express admin code from nightlife-mcp

---

