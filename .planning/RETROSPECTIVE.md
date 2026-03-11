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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 5 | 7 | Established VIP pricing tool pattern, discovered verification gap |
| v2.0 | 4 | 7 | Cross-repo migration, non-blocking side effects, Zod destructuring |

### Top Lessons (Verified Across Milestones)

1. Verify each phase at completion — remediation phases are wasted effort
2. Explicit field handling over spread operators — TypeScript strict mode catches what spreads hide
