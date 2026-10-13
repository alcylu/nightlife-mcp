# Nightlife MCP architecture audit — 2026-10-13

## Executive summary

The service is healthy and the original design remains workable, but its contracts and documentation had drifted behind `nlt-admin` and `nightlife`. The highest-risk issues were a production fallback key recorded in a tracked public-repository document, vulnerable dependencies, and multiple independently maintained response schemas that silently removed fields already returned by the service layer.

This audit updated the safe additive contract. A production deploy and credential rotation are still required.

## Evidence reviewed

- Current `nightlife-mcp` implementation, tests, package graph, HTTP/MCP transport, REST/OpenAPI surface, auth, and production health endpoint.
- Current `nlt-admin` schema/product changes through 2026-10-13, especially the genre catalog, location hierarchy, event media, lineup/crew, Care Crew, ticketing, and mobile workflows.
- Current `nightlife` discovery/detail contracts through 2026-10-10, especially canonical routes, nightlife relevance, performer type routes, area hierarchy, video media, and unlinked performer credits.
- Live read-only queries against the shared production Supabase and the public MCP health/OpenAPI endpoints.

## Changes made in this pass

### Security and dependencies

- Updated the MCP SDK and transitive production dependencies to patched versions. `npm audit --omit=dev` now reports zero vulnerabilities.
- Removed the literal production fallback API key from tracked documentation. Rotate/revoke the deployed value because Git history still contains it.
- One low-severity `esbuild` advisory remains in the development-only `tsx` toolchain; no patched `tsx` release is currently available within the dependency line.

### Contract reconciliation

- Preserved `heat` and `event_media` in every MCP event schema instead of letting Zod strip them.
- Added image and video media, including `thumbnail_url` and `title`, across event search, event detail, venue upcoming events, and performer upcoming events.
- Reconciled lineups with the public site: off-stage crew is excluded, declined credits are excluded, and confirmed/pending unlinked billed names are retained.
- Changed generated links from obsolete `/en/{city}/...` paths to canonical English `/{city}/...` paths.
- Added performer type to performer responses and generate the correct type-specific profile route instead of sending every performer to `/djs/`.
- Added MCP `series_id` support to `search_events`, matching the service and REST capability.
- Added REST `sort_by` and `vip_booking_supported_only` handling and documented them in OpenAPI.
- Updated genre resolution to honor `genre_aliases` and expand parent genres to descendants through the shared genre catalog.
- Updated area discovery and event/venue area projection to use the `areas` hierarchy, with legacy venue text retained as a fallback.
- Updated OpenAPI event heat/media and performer-type contracts.

### Marketplace packaging

- Added `skills/tokyo-nightlife-concierge/`, a portable read-mostly consumer skill with explicit confirmation gates for guest-list and VIP submissions.
- Validated the skill with the bundled skill validator and built a local ZIP at `dist/skills/tokyo-nightlife-concierge.zip` (the `dist` directory is intentionally gitignored).

## Verification

- `npm test`: 124/124 passing.
- `npm run check`: passing.
- `npm run build`: required before release; run again after the final diff review.
- Live read-only smoke: canonical event URLs, hierarchy areas, event media, and video-bearing event details returned successfully.
- Production health at audit time: healthy, streamable HTTP, 37 retained sessions, 3 active user-backed API-key users, and 0 usage rows reported by the health aggregation for its nominal 24-hour window.

## Remaining architecture work

### P0 — before marketplace promotion

1. **Rotate the exposed fallback key.** Create a replacement in the deployment secret manager, update known clients, deploy, verify, then revoke/remove the old value. Consider disabling env-key fallback after client migration.
2. **Deploy and smoke the current contract update.** Test free-tier and ops-tier tool lists separately so internal tools cannot appear to public keys.
3. **Add a real production contract smoke.** It should initialize MCP, list tools, call representative discovery/detail tools, and assert structured response fields. The current smoke focuses mainly on auth.
4. **Correct usage telemetry.** `api_calls_24h` sums date buckets for today and yesterday, which is not a rolling 24-hour metric, and current production reported zero calls despite retained sessions. Decide whether sessions without calls are expected or metering is incomplete.

### P1 — reduce drift and operating risk

1. **Create one contract source.** TypeScript interfaces, Zod tool schemas, and handwritten OpenAPI currently duplicate the same objects. Generate JSON Schema/OpenAPI from exported Zod schemas or a shared contract module.
2. **Consolidate event hydration.** Event/genre/media/lineup projection is repeated across events, venues, performers, recommendations, and the consumer site. Move the stable public projection into a versioned database RPC/view or shared package.
3. **Add session expiry.** HTTP sessions are retained until clients explicitly close them or the process restarts. Add idle and absolute TTLs plus cleanup metrics.
4. **Split trust domains.** Public discovery, consumer writes, Stripe/deposit handling, dashboard routes, and ops-only MCP tools share one process and service-role credential. Split at least ops/deposit administration from the public read/consumer-request service, or use narrower database roles/RPC-only writes.
5. **Move filtering into bounded database queries.** Some area/text filter paths fetch a maximum candidate window and filter in memory. This can produce incomplete pages or false empty results in a large catalog. Replace with indexed RPCs or relational filters and cursor pagination.
6. **Align relevance policy.** The public site filters broad “tonight/weekend” feeds to nightlife-positive events while MCP returns all published events. Decide whether MCP needs an explicit `discovery_scope=nightlife|all` contract instead of silently diverging.
7. **Add version negotiation/deprecation.** The package remains `0.3.0`, server defaults mention `0.1.0`, REST advertises `1.0.0`, and documentation uses several tool counts. Establish one release version and a deprecation policy for additive and breaking changes.

### P2 — product expansion

- Expose reviewed venue editorial/safety/accessibility metadata when those fields have a stable public contract.
- Expose SoundCloud samples only through validated public URLs and only if agent clients benefit from them.
- Add a public series lookup tool rather than requiring callers to discover opaque `series_id` values elsewhere.
- Add cache/ETag support for cities, areas, genres, and other slowly changing helper data.

## Agensi email evaluation

### What checks out

- Agensi publicly states that listing is free, creators retain ownership, the license is non-exclusive, and creators receive 70% of net sales while Agensi retains 30%.
- The sender, Joeri Brons, has a public association with Agensi.
- Agensi accepts a ZIP containing `SKILL.md` and supporting files and distributes skills through its own MCP connection.

### What is not independently verified

- The “65,000+ visitors a month” claim is self-reported outreach. Public Agensi pages say “thousands,” and a public company post previously claimed 50,000 monthly visitors; no independent analytics source found in this audit substantiated 65,000.
- Marketplace examples of creator revenue are explicitly illustrative, not verified seller results.

### Commercial recommendation

List the companion skill as **free** initially and use it as distribution for the Nightlife API, VIP/guest-list conversion, and developer-account funnel. Charging for a short instruction layer that depends on a separately configured API key is a weak buyer proposition and would duplicate knowledge already present in an open-source repository.

A paid subscription could make sense later only if it includes maintained concierge policy, broader city coverage, premium API allowance/SLA, analytics, or a materially richer workflow. Keep staff/ops tools out of the marketplace skill.

Before accepting, review the current terms for payout/KYC, the 30% fee, refund reversals, the license to distribute the skill, platform dependence for delivery, and the clause allowing revenue-split changes with notice. Do not provide Agensi with production API keys or embed a shared key in the skill.
