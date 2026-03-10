# Requirements: VIP Generic Pricing Redesign

**Defined:** 2026-03-10
**Core Value:** Users get accurate, trustworthy VIP pricing information and a frictionless path to submit a booking inquiry

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### VIP Pricing Tool

- [x] **VPRC-01**: MCP tool returns weekday and weekend minimum spend ranges per venue (aggregated from day-defaults) *(service layer: 01-01)*
- [x] **VPRC-02**: MCP tool checks venue operating hours and returns `venue_open: false` with message if venue is closed on requested date *(service layer: 01-01)*
- [x] **VPRC-03**: MCP tool returns zone-level pricing summary (zone name, capacity range, weekday min, weekend min) *(service layer: 01-01)*
- [x] **VPRC-04**: MCP tool returns table chart image URL when available *(service layer: 01-01)*
- [x] **VPRC-05**: MCP tool returns explicit `pricing_configured: false` with message when no pricing data exists for a venue *(service layer: 01-01)*
- [x] **VPRC-06**: MCP tool returns booking affordance fields (`booking_supported`, `booking_note`) so agent knows when to offer inquiry *(service layer: 01-01)*
- [ ] **VPRC-07**: MCP tool queries events for the requested date and returns event context / busy night signal
- [ ] **VPRC-08**: MCP tool returns `pricing_approximate` flag so agent can modulate language ("around" vs "exactly")
- [x] **VPRC-09**: MCP tool uses service-day date resolution (6am JST cutoff) for day-of-week classification *(service layer: 01-01)*

### REST API

- [x] **REST-01**: GET `/api/v1/venues/:id/vip-pricing` returns same data as MCP tool
- [x] **REST-02**: REST endpoint uses shared API key auth middleware

### Tool Lifecycle

- [ ] **LIFE-01**: Old `get_vip_table_availability` and `get_vip_table_chart` tools removed from server registration
- [x] **LIFE-02**: New `get_vip_pricing` tool description includes behavioral guidance for agents (when to call, what to do after)

### Ember Agent

- [ ] **EMBR-01**: Ember SKILL.md updated to use `get_vip_pricing` instead of old two-tool flow
- [ ] **EMBR-02**: Ember SKILL.md includes mandatory confirmation gate before calling `create_vip_booking_request`
- [ ] **EMBR-03**: Ember SKILL.md explicitly states table chart is layout reference only — do not infer availability from image

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Multi-Venue

- **MULT-01**: Allow `venue_ids[]` param to compare 2-3 venues in one call

### Pricing Detail

- **DTIL-01**: Day-of-week full breakdown (Mon-Sun min spends) for power users
- **DTIL-02**: Deposit-linked pricing — surface estimated deposit amount in pricing response

## Out of Scope

| Feature | Reason |
|---------|--------|
| Per-table real-time availability status | Venues won't maintain this data — anti-feature that creates false expectations |
| Instant booking / instant confirmation | Tokyo VIP requires human confirmation (deposit, group size, event vetting) |
| Real-time bottle menu with prices | Menus change nightly, leads to pricing disputes |
| Per-table detailed view | Only reintroduce if venues adopt maintenance workflows |
| DB schema changes | Existing tables sufficient — keep structure for future use |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| VPRC-01 | Phase 1 | Done (01-01) |
| VPRC-02 | Phase 1 | Done (01-01) |
| VPRC-03 | Phase 1 | Done (01-01) |
| VPRC-04 | Phase 1 | Done (01-01) |
| VPRC-05 | Phase 1 | Done (01-01) |
| VPRC-06 | Phase 1 | Done (01-01) |
| VPRC-07 | Phase 3 | Pending |
| VPRC-08 | Phase 3 | Pending |
| VPRC-09 | Phase 1 | Done (01-01) |
| REST-01 | Phase 1 | Complete |
| REST-02 | Phase 1 | Complete |
| LIFE-01 | Phase 3 | Pending |
| LIFE-02 | Phase 1 | Complete |
| EMBR-01 | Phase 2 | Pending |
| EMBR-02 | Phase 2 | Pending |
| EMBR-03 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after plan 01-01 completion (VPRC-01–06, VPRC-09 done at service layer)*
