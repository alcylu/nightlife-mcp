# Requirements: VIP Generic Pricing Redesign

**Defined:** 2026-03-10
**Core Value:** Users get accurate, trustworthy VIP pricing information and a frictionless path to submit a booking inquiry

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### VIP Pricing Tool

- [ ] **VPRC-01**: MCP tool returns weekday and weekend minimum spend ranges per venue (aggregated from day-defaults)
- [ ] **VPRC-02**: MCP tool checks venue operating hours and returns `venue_open: false` with message if venue is closed on requested date
- [ ] **VPRC-03**: MCP tool returns zone-level pricing summary (zone name, capacity range, weekday min, weekend min)
- [ ] **VPRC-04**: MCP tool returns table chart image URL when available
- [ ] **VPRC-05**: MCP tool returns explicit `pricing_configured: false` with message when no pricing data exists for a venue
- [ ] **VPRC-06**: MCP tool returns booking affordance fields (`booking_supported`, `booking_note`) so agent knows when to offer inquiry
- [ ] **VPRC-07**: MCP tool queries events for the requested date and returns event context / busy night signal
- [ ] **VPRC-08**: MCP tool returns `pricing_approximate` flag so agent can modulate language ("around" vs "exactly")
- [ ] **VPRC-09**: MCP tool uses service-day date resolution (6am JST cutoff) for day-of-week classification

### REST API

- [ ] **REST-01**: GET `/api/v1/venues/:id/vip-pricing` returns same data as MCP tool
- [ ] **REST-02**: REST endpoint uses shared API key auth middleware

### Tool Lifecycle

- [ ] **LIFE-01**: Old `get_vip_table_availability` and `get_vip_table_chart` tools removed from server registration
- [ ] **LIFE-02**: New `get_vip_pricing` tool description includes behavioral guidance for agents (when to call, what to do after)

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
| VPRC-01 | — | Pending |
| VPRC-02 | — | Pending |
| VPRC-03 | — | Pending |
| VPRC-04 | — | Pending |
| VPRC-05 | — | Pending |
| VPRC-06 | — | Pending |
| VPRC-07 | — | Pending |
| VPRC-08 | — | Pending |
| VPRC-09 | — | Pending |
| REST-01 | — | Pending |
| REST-02 | — | Pending |
| LIFE-01 | — | Pending |
| LIFE-02 | — | Pending |
| EMBR-01 | — | Pending |
| EMBR-02 | — | Pending |
| EMBR-03 | — | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 0
- Unmapped: 16 ⚠️

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after initial definition*
