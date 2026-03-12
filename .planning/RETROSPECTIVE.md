# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v2.0 — VIP Dashboard Migration

**Shipped:** 2026-03-12
**Phases:** 4 | **Plans:** 7 | **Tasks:** 14

### What Was Built
- Full VIP booking admin dashboard in nlt-admin (Next.js) with list, detail, create, and status update
- Stripe checkout session creation and Resend email dispatch as non-blocking side effects in nlt-admin API routes
- Status update UI with valid transition map, default messages, and deposit link display
- Surgical removal of 3,167 lines of Express admin code from nightlife-mcp

### What Worked
- Cross-repo migration pattern: build in nlt-admin first, verify, then remove from nightlife-mcp — zero downtime
- Non-blocking side effect pattern for Stripe/Resend — admin status updates never blocked by external service failures
- Explicit Zod destructuring convention (discovered in Phase 7, applied consistently through Phase 8)
- AuditText union type pattern for TypeScript i18n text props — solved type narrowing issue once, reused everywhere
- keepPreviousData in TanStack Query — eliminated flicker during 60s auto-refresh

### What Was Inefficient
- v1.0 audit found Phase 2 had no VERIFICATION.md — led to Phase 4 being entirely remediation (verification + metadata hygiene). Could have been avoided by verifying each phase at completion
- SUMMARY frontmatter inconsistency across v1.0 phases required batch fixes in Phase 4
- Phase 9 cleanup gate criteria (48h production verification) was not formally enforced — proceeded based on functional completion

### Patterns Established
- Non-blocking side effects: wrap Stripe/Resend in try/catch, log failures, never rethrow
- Zod destructuring: always destructure parsed.data into explicit fields, never spread
- Admin role guard: session client for auth check, service role client for data queries
- Dialog form reset on both close and successful submit
- Deposit join in list queries as non-fatal supplementary data

### Key Lessons
1. Verify each phase at completion time — batch verification later creates entire remediation phases
2. Zod's type inference makes spread operations unreliable — explicit destructuring is the safe default
3. Cross-repo migrations benefit from strict sequencing: read-only first, mutations second, side effects third, cleanup last
4. Non-blocking side effects are the right default for admin tools — ops should never be blocked by external service failures

### Cost Observations
- Model mix: ~60% opus, ~40% sonnet (planning in opus, execution in sonnet)
- All 4 phases executed in a single day
- Notable: Phase 8 Plan 02 (status update UI) completed in 2 minutes — fastest plan in the milestone

---

## Milestone: v3.0 — Fuzzy Search

**Shipped:** 2026-03-12
**Phases:** 3 | **Plans:** 4

### What Was Built
- PostgreSQL pg_trgm + unaccent extensions with IMMUTABLE f_unaccent wrapper and GIN trigram index
- search_venues_fuzzy RPC with word_similarity matching and configurable threshold
- Zero-dependency normalizeQuery() and stripAccents() TypeScript utility (NFD + diacritic regex)
- Two-pass venue search: exact/normalized match first, fuzzy RPC fallback on zero results
- Accent-normalized event and performer search using two-needle pattern (queryText for DB, queryNeedle for client filter)

### What Worked
- Hybrid architecture decision: DB-level fuzzy for venues (450 records, needs typo tolerance), TypeScript-only normalization for events/performers (scoped by city+date, accent stripping sufficient)
- IMMUTABLE wrapper pattern identified early in research — avoided GIN index creation failure
- Two-needle pattern (queryText for DB ILIKE, queryNeedle for client filter) kept word-boundary matching intact while adding accent normalization
- shouldAttemptFuzzy guard function cleanly separated the decision logic from the execution — fully testable, 5 unit tests
- Early return from fuzzy path preserved RPC word_similarity ordering instead of re-ranking by event activity

### What Was Inefficient
- NORM-03 (number-word equivalence) was over-specified in requirements — plan correctly narrowed it, but the gap still shows up in the audit as "partial". Should have updated the requirement during planning
- Phases 10 and 12 had draft Nyquist VALIDATION.md files that were never completed during execution — Phase 11 was fully compliant
- Venues pass-1 uses sanitizeIlike while events/performers use normalizeQuery — functionally correct but inconsistent pattern across services

### Patterns Established
- Two-pass search: exact/normalized match first, fuzzy RPC fallback only on zero results
- Fuzzy ordering preserved via position-index map (not re-ranked by business logic)
- Two-needle pattern: queryText (sanitizeIlike) for DB ILIKE, queryNeedle (normalizeQuery) for client-side filter
- Haystack normalization mirrors needle normalization: stripAccents + space-collapse + lowercase on both sides
- CONCURRENTLY for all shared-DB index operations (non-blocking)

### Key Lessons
1. Update requirements when plans deliberately narrow scope — avoids audit noise and "partial" tags
2. Complete Nyquist validation during execution, not after — draft VALIDATION.md files are worse than none (false sense of coverage)
3. Research phase pays off for DB migrations — identifying unaccent STABLE vs IMMUTABLE early prevented wasted time
4. Two-pass search is the right default for "find the thing the user meant" — cheap exact path handles 95% of queries, expensive fuzzy path handles the rest

### Cost Observations
- Model mix: ~50% opus, ~50% sonnet
- All 3 phases executed in a single day
- Notable: Entire milestone (research → plan → execute → audit → complete) in one day

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 5 | 7 | Established VIP pricing tool pattern, discovered verification gap |
| v2.0 | 4 | 7 | Cross-repo migration, non-blocking side effects, Zod destructuring |
| v3.0 | 3 | 4 | Hybrid fuzzy search (DB + TS), two-pass search pattern, requirement scoping lessons |

### Top Lessons (Verified Across Milestones)

1. Verify each phase at completion — remediation phases are wasted effort
2. Explicit field handling over spread operators — TypeScript strict mode catches what spreads hide
3. Update requirements when plans deliberately narrow scope — avoids audit noise
4. Research phase pays off for DB/infrastructure work — identifying pitfalls early prevents wasted time
