# Requirements: Nightlife MCP — VIP Operations

**Defined:** 2026-03-10
**Core Value:** Users get accurate, trustworthy VIP pricing information and a frictionless path to submit a booking inquiry

## v1.0 Requirements (Complete)

All v1.0 requirements shipped and verified. See v1.0 milestone archive for details.

### VIP Pricing Tool

- [x] **VPRC-01**: MCP tool returns weekday and weekend minimum spend ranges per venue
- [x] **VPRC-02**: MCP tool checks venue operating hours and returns venue_open status
- [x] **VPRC-03**: MCP tool returns zone-level pricing summary
- [x] **VPRC-04**: MCP tool returns table chart image URL when available
- [x] **VPRC-05**: MCP tool returns pricing_configured: false when no pricing data exists
- [x] **VPRC-06**: MCP tool returns booking affordance fields
- [x] **VPRC-07**: MCP tool returns event context / busy night signal
- [x] **VPRC-08**: MCP tool returns pricing_approximate flag
- [x] **VPRC-09**: MCP tool uses service-day date resolution (6am JST cutoff)

### REST API

- [x] **REST-01**: GET /api/v1/venues/:id/vip-pricing returns same data as MCP tool
- [x] **REST-02**: REST endpoint uses shared API key auth middleware

### Tool Lifecycle

- [x] **LIFE-01**: Old VIP tools removed from server registration
- [x] **LIFE-02**: New get_vip_pricing tool includes behavioral guidance

### Ember Agent

- [x] **EMBR-01**: Ember uses get_vip_pricing instead of old two-tool flow
- [x] **EMBR-02**: Mandatory confirmation gate before booking requests
- [x] **EMBR-03**: Table chart is layout reference only

## v2.0 Requirements

Requirements for VIP dashboard migration from nightlife-mcp to nlt-admin. Each maps to roadmap phases.

### Dashboard List

- [ ] **DASH-01**: Admin can view a paginated list of VIP bookings with status badges
- [ ] **DASH-02**: Admin can filter bookings by status (multi-select)
- [ ] **DASH-03**: Admin can filter bookings by date range
- [ ] **DASH-04**: Admin can search bookings by customer name, email, or phone
- [ ] **DASH-05**: Admin can filter bookings by venue
- [ ] **DASH-06**: Admin sees agent task status badge on booking list rows
- [ ] **DASH-07**: Admin sees empty state with clear-filters CTA when no results match
- [ ] **DASH-08**: Admin booking list auto-refreshes in background every 60 seconds

### Booking Detail

- [x] **DETAIL-01**: Admin can view full booking detail (customer info, venue, table code, min spend, special requests)
- [x] **DETAIL-02**: Admin can view status history timeline with actor, timestamp, and notes
- [x] **DETAIL-03**: Admin can view edit audit log with field-level before/after values
- [x] **DETAIL-04**: Admin can see agent task status on booking detail

### Mutations

- [ ] **MUTATE-01**: Admin can update booking status through full pipeline (submitted → in_review → deposit_required → confirmed/rejected/cancelled)
- [ ] **MUTATE-02**: Status change to deposit_required automatically creates Stripe checkout session
- [ ] **MUTATE-03**: Status changes to deposit_required/confirmed/rejected automatically send email via Resend
- [ ] **MUTATE-04**: Admin can create a booking on behalf of a customer with venue selector
- [ ] **MUTATE-05**: Admin can set customer-visible status message on status update
- [ ] **MUTATE-06**: Admin can write internal notes (not customer-visible) on booking
- [ ] **MUTATE-07**: Admin can add a change note explaining edits

### Access Control

- [x] **AUTH-01**: VIP dashboard pages accessible only to super_admin and admin roles
- [x] **AUTH-02**: VIP API routes verify role server-side (not just UI-gated)
- [x] **AUTH-03**: VIP section appears in nlt-admin navigation for authorized users

### Cleanup

- [ ] **CLEAN-01**: Express admin dashboard code removed from nightlife-mcp (src/admin/)
- [ ] **CLEAN-02**: Admin API routes removed from nightlife-mcp Express server
- [ ] **CLEAN-03**: Dashboard auth middleware and config removed from nightlife-mcp

## Future Requirements

### Enhanced Ops

- **OPS-01**: Admin can export bookings to CSV
- **OPS-02**: Admin can bulk-update booking statuses
- **OPS-03**: Admin can link to Stripe dashboard from booking detail

### Multi-Venue Pricing

- **MULT-01**: Allow venue_ids[] param to compare 2-3 venues in one call

### Pricing Detail

- **DTIL-01**: Day-of-week full breakdown (Mon-Sun min spends) for power users
- **DTIL-02**: Deposit-linked pricing — surface estimated deposit amount in pricing response

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time websocket push | 2 ops users, low volume — 1-min polling is sufficient |
| Bulk status update | Per-booking side effects (Stripe, email) make bulk risky |
| Email template editing UI | Templates are stable, change via code deploy |
| In-app Stripe payment management | Stripe dashboard handles this directly |
| Rich text in status messages | Plain text injected into email templates |
| Notification/alert system | Low volume, ops checks dashboard on normal cadence |
| Venue organizer VIP access | Admin-only for now |
| Per-table real-time availability | Venues won't maintain this data |
| CSV export | Not in current Express dashboard; add when ops requests |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| VPRC-01 | Phase 1 (v1.0) | Complete |
| VPRC-02 | Phase 1 (v1.0) | Complete |
| VPRC-03 | Phase 1 (v1.0) | Complete |
| VPRC-04 | Phase 1 (v1.0) | Complete |
| VPRC-05 | Phase 1 (v1.0) | Complete |
| VPRC-06 | Phase 1 (v1.0) | Complete |
| VPRC-07 | Phase 3 (v1.0) | Complete |
| VPRC-08 | Phase 3 (v1.0) | Complete |
| VPRC-09 | Phase 1 (v1.0) | Complete |
| REST-01 | Phase 1 (v1.0) | Complete |
| REST-02 | Phase 1 (v1.0) | Complete |
| LIFE-01 | Phase 3 (v1.0) | Complete |
| LIFE-02 | Phase 1 (v1.0) | Complete |
| EMBR-01 | Phase 4 (v1.0) | Complete |
| EMBR-02 | Phase 4 (v1.0) | Complete |
| EMBR-03 | Phase 4 (v1.0) | Complete |
| DASH-01 | Phase 6 (v2.0) | Pending |
| DASH-02 | Phase 6 (v2.0) | Pending |
| DASH-03 | Phase 6 (v2.0) | Pending |
| DASH-04 | Phase 6 (v2.0) | Pending |
| DASH-05 | Phase 6 (v2.0) | Pending |
| DASH-06 | Phase 6 (v2.0) | Pending |
| DASH-07 | Phase 6 (v2.0) | Pending |
| DASH-08 | Phase 6 (v2.0) | Pending |
| DETAIL-01 | Phase 6 (v2.0) | Complete |
| DETAIL-02 | Phase 6 (v2.0) | Complete |
| DETAIL-03 | Phase 6 (v2.0) | Complete |
| DETAIL-04 | Phase 6 (v2.0) | Complete |
| MUTATE-01 | Phase 8 (v2.0) | Pending |
| MUTATE-02 | Phase 8 (v2.0) | Pending |
| MUTATE-03 | Phase 8 (v2.0) | Pending |
| MUTATE-04 | Phase 7 (v2.0) | Pending |
| MUTATE-05 | Phase 8 (v2.0) | Pending |
| MUTATE-06 | Phase 7 (v2.0) | Pending |
| MUTATE-07 | Phase 7 (v2.0) | Pending |
| AUTH-01 | Phase 6 (v2.0) | Complete |
| AUTH-02 | Phase 6 (v2.0) | Complete |
| AUTH-03 | Phase 6 (v2.0) | Complete |
| CLEAN-01 | Phase 9 (v2.0) | Pending |
| CLEAN-02 | Phase 9 (v2.0) | Pending |
| CLEAN-03 | Phase 9 (v2.0) | Pending |

**Coverage:**
- v1.0 requirements: 16 total (all complete)
- v2.0 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-11 — v2.0 traceability complete (Phases 6-9)*
