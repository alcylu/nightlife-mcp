# Feature Research

**Domain:** Inquiry-based VIP/bottle service pricing tool (nightlife MCP + AI concierge)
**Researched:** 2026-03-10
**Confidence:** HIGH (current state codebase read directly; competitor analysis from live platforms)

---

## Context

This research covers the redesign of `get_vip_table_availability` and `get_vip_table_chart` from per-table availability checking to generic pricing presentation. The downstream consumer is Ember (AI concierge) which presents this info conversationally to hotel guests.

**Competitors analyzed:**
- Discotech (US market leader, inquiry-based with agent follow-up)
- VIPFlow / NightlifeVIPTables (Tokyo-specific brokers, "price on request" model)
- Club Bookers (Tokyo broker)
- ZEROTOKYO (venue-direct, event-linked pricing)
- TablelistPro (SaaS for venue operators)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Weekday vs weekend minimum spend | Every competitor shows this split; it's the primary pricing axis | LOW | Already seeded in `vip_table_day_defaults`. Sum to ranges per day-type. |
| Venue open / closed on requested date | Users need to know if the venue operates that night before caring about pricing | LOW | `venue_operating_hours` check already implemented; keep and expose |
| Currency label | Amounts are meaningless without ¥ or $ context | LOW | Always JPY for current venues; make explicit in response |
| Table chart / floor plan image URL | Discotech, ZEROTOKYO, and all brokers surface this. Users want to see where they'd sit | LOW | Already in `layout_image_url`; include in new tool response |
| Party size guidance | "This table seats 4-8" orients the user — they don't want to discover later it's too small | LOW | Already stored as `capacity_min`/`capacity_max` on each table row |
| Booking inquiry action | After seeing pricing, users need a clear next step. "Contact to book" or a form | LOW | `create_vip_booking_request` already exists; new tool should surface this affordance explicitly in output |
| Event context for the requested date | Every broker mentions "prices spike with famous DJs." Users need to know if it's a big night | MEDIUM | Requires joining to `event_occurrences` for the date — already available via event search service |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Pricing honesty flag (`pricing_approximate`) | Competitors either hide uncertainty or claim false precision. Labeling ranges as approximate builds trust and sets expectations | LOW | Field already on DB rows; surface it in the new generic response |
| AI-native response structure | Discotech's data is for human eyes on a webpage. Our response must be designed for an LLM to narrate — prose-ready fields, no per-table noise | LOW | Design the schema with a `summary` or `narrative_hint` field Ember can echo directly |
| Zone-level pricing summary | Rather than per-table noise, group by zone (dancefloor, VIP room, etc.) so Ember can say "dancefloor tables from ¥100K, VIP room from ¥200K" | MEDIUM | Aggregate over `zone` field from `vip_venue_tables` joined to `vip_table_day_defaults` |
| "Is tonight busy?" signal | Linking event context to pricing framing (busy DJ night = expect weekend-tier prices even on Thursday) is something no competitor automates | MEDIUM | A boolean flag or event_name string derived from querying events on the date |
| Graceful degradation for unconfigured venues | Return a clear "pricing not available" with a contact path — not an empty array or 404 | LOW | Current behavior silently returns empty or "unknown"; new tool should return explicit `pricing_unavailable: true` with messaging |
| Table chart URL always returned separately | Some competitors say "contact us for floor plan." We always serve the image. Builds credibility for the AI concierge. | LOW | Layout image already in Supabase storage; include unconditionally when available |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Per-table real-time availability status | Feels more precise — users want to know if their preferred table is open | Venues won't maintain this. Showing "available" is a lie. Creates false expectations and bad reviews when table isn't actually free. | Show generic pricing ranges by zone/day-type. Let the booking inquiry handle specifics. |
| Instant booking / instant confirmation | Users want immediacy — "book it now" | Tokyo nightclub VIP requires human confirmation (deposit negotiation, group size check, event vetting). Instant booking would require venue PMS integration that doesn't exist. | Inquiry submission with fast ops follow-up (target: confirm within 24h) |
| Real-time bottle menu with prices | Operators say "I want to show the full menu upfront" | Bottle menus change nightly, brand allocations vary, tax+service varies. Leads to pricing disputes. | State minimum spend clearly; note "bottle menu presented at the table" |
| Seat charge / table charge as separate line item | Accurately represents venue billing structure | Confuses users who think they're paying a reservation fee plus alcohol. The Tokyo nightclub seat charge model is alien to most hotel guests. | Fold into the minimum spend: "minimum spend is ¥100K all-in" with a note that this covers table + alcohol |
| Availability calendar (multi-date picker) | Power users want to see pricing across many dates | Requires the tool to be called once per date; expensive. Misleading because pricing can change as the event date approaches. | Ask the user their target date; return pricing for that date only |
| Cancellation / modification self-serve | Users expect this from hotel booking flows | VIP table bookings involve human ops commitment. A "cancel" button breaks the concierge relationship. | `cancel_vip_booking_request` already exists for legitimate cancellations; don't surface as a prominent feature in the discovery flow |

---

## Feature Dependencies

```
[Generic pricing response]
    └──requires──> [Venue operating hours check]      (is venue open on this date?)
    └──requires──> [Day-type classification]          (is this date a weekday or weekend?)
    └──requires──> [vip_table_day_defaults aggregation] (what are the min spend ranges?)
    └──enhances──> [Event context lookup]             (busy night signal)
    └──enhances──> [Table chart image URL]            (visual floor plan)

[Booking inquiry affordance]
    └──requires──> [Generic pricing response]         (user must see pricing before inquiring)
    └──requires──> [create_vip_booking_request]       (already exists — stays unchanged)

[Zone-level pricing summary]
    └──requires──> [Generic pricing response]
    └──requires──> [vip_venue_tables.zone field]      (zone labels already in DB)

[Event context signal]
    └──requires──> [events service]                   (searchEvents or getVipEventForDate)
    └──enhances──> [Generic pricing response]         (adds "busy night" context to output)

[Ember conversational flow]
    └──requires──> [Generic pricing response]         (structured data to narrate)
    └──requires──> [Booking inquiry affordance]       (action to guide user toward)
    └──requires──> [Updated Ember system prompts]     (in openclaw repo — separate work item)
```

### Dependency Notes

- **Generic pricing requires operating hours check:** The most disorienting response is pricing info for a night the venue is closed. Operating hours gate must run first.
- **Zone-level summary enhances generic pricing:** Groups per-table data into 2-3 human-readable tiers. Ember can narrate "dancefloor from ¥100K, VIP room from ¥200K" far better than a list of table codes.
- **Event context is an enhancement, not a blocker:** Pricing response is valid without it. Treat event lookup as best-effort; if no event found, omit the field rather than blocking the response.
- **Ember prompts conflict with old tool schema:** Old tool returns per-table `status: available/held/blocked`. New tool drops this. Ember prompts must be updated in the same release or the agent will try to narrate availability that no longer exists.

---

## MVP Definition

### Launch With (v1)

Minimum viable for the redesign to be useful to Ember and hotel concierge clients.

- [ ] `get_vip_pricing` tool — returns weekday/weekend min spend ranges per venue, venue open flag, table chart image URL — core replacement for `get_vip_table_availability` + `get_vip_table_chart`
- [ ] Venue operating hours gate — return `venue_open: false` with message if venue is closed on requested date
- [ ] Day-type classification — label each date as `weekday` or `weekend` in the response; show appropriate min spend tier
- [ ] Zone-level pricing summary — aggregate `vip_table_day_defaults` by zone, return `{ zone, capacity_range, weekday_min_spend, weekend_min_spend }[]`
- [ ] Layout image URL — unconditionally include `layout_image_url` when available
- [ ] Booking inquiry affordance — include `booking_supported: true/false` and a `booking_note` field so Ember knows when to offer `create_vip_booking_request`
- [ ] Pricing unavailable fallback — explicit `pricing_unavailable: true` + message when no day-default rows exist (instead of empty array)
- [ ] Ember system prompt update — present pricing conversationally, guide toward "want me to check with the venue?" → inquiry submission

### Add After Validation (v1.x)

Add once the core tool is live and Ember is using it.

- [ ] Event context signal — query `event_occurrences` for the requested date; surface `event_name`, `featured`, and a `busy_night` boolean in the response; trigger: first hotel client complaint that "it didn't mention the big DJ night"
- [ ] `pricing_approximate` flag in output — surface the existing DB field so Ember can say "around ¥100K" vs "exactly ¥100K"; trigger: first user dispute about pricing accuracy
- [ ] Multi-venue comparison support — allow `venue_ids[]` param to compare 2-3 venues in one call; trigger: Ember getting "compare these clubs" requests from hotel guests

### Future Consideration (v2+)

Defer until product-market fit established.

- [ ] Deposit-linked pricing — surface estimated deposit amount from the booking flow in the pricing response; defer until deposit_required flow is more common
- [ ] Day-of-week full breakdown — show Mon-Sun min spends for power users; defer because weekday/weekend covers 90% of use cases
- [ ] Per-table detailed view — for venues that do maintain per-table data; reintroduce as optional mode once venues adopt; defer because the point of this redesign is to move away from this

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Weekday/weekend min spend ranges | HIGH | LOW | P1 |
| Venue open/closed gate | HIGH | LOW | P1 |
| Table chart image URL | HIGH | LOW | P1 |
| Zone-level pricing summary | HIGH | MEDIUM | P1 |
| Booking inquiry affordance | HIGH | LOW | P1 |
| Pricing unavailable fallback | MEDIUM | LOW | P1 |
| Ember system prompt update | HIGH | MEDIUM | P1 |
| Event context / busy night signal | MEDIUM | MEDIUM | P2 |
| `pricing_approximate` flag | MEDIUM | LOW | P2 |
| Multi-venue comparison | LOW | MEDIUM | P3 |
| Day-of-week full breakdown | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for launch (this milestone)
- P2: Should have, add when core is validated
- P3: Nice to have, future milestone

---

## Competitor Feature Analysis

| Feature | Discotech | VIPFlow / ClubBookers | Our Approach |
|---------|-----------|-----------------------|--------------|
| Weekday/weekend pricing split | Yes — prominently | Rarely — "price on request" | Yes — from `vip_table_day_defaults` |
| Per-table availability | Yes — shown when data available | No — contact required | No — explicitly removed |
| Floor plan image | Yes — per venue | "Contact for map" | Yes — always served via Supabase storage |
| Event / DJ context | Partially — shows upcoming events | Mentions "prices spike with big DJs" | Yes — best-effort event lookup for date |
| Booking flow type | Inquiry → agent → confirm (SMS/WhatsApp/email) | Inquiry → WhatsApp → confirm | Inquiry → MCP tool → ops email → confirm |
| AI / LLM native | No | No | Yes — schema designed for LLM narration |
| Pricing transparency signal | No | No | Yes — `pricing_approximate` flag |
| Graceful degradation | "No tables listed" (opaque) | "Price on request" (honest) | Explicit `pricing_unavailable` with message |

---

## Sources

- [Discotech bottle service help: what is bottle service and how do I pay](https://help.discotech.me/articles/what-is-bottle-service-how-does-it-work-and-how-do-i-pay/)
- [Discotech: what is minimum spend](https://help.discotech.me/articles/what-is-minimum-spend/)
- [Discotech NYC bottle service guide](https://discotech.me/new-york/bottle-service/)
- [VIPFlow: 1 Oak Tokyo VIP table](https://vipflow.com/1-oak-tokyo-vip-table/)
- [VIPFlow: CE LA VI Tokyo VIP table](https://vipflow.com/celavi-tokyo-vip-table/)
- [Tokyo Night Owl: how to book VIP tables](https://tokyonightowl.com/tokyo-vip-how-to-book-nightclub-tables/)
- [ZEROTOKYO VIP page](https://zerotokyo.jp/en/vip/)
- [TablelistPro nightclub software](https://www.tablelistpro.com/)
- [NightlifeVIPTables Tokyo](https://nightlifeviptables.com/tokyo/)
- Existing codebase: `/Users/alcylu/Apps/nightlife-mcp/src/tools/vipTables.ts`, `vipBookings.ts`, `src/services/vipTables.ts`
- Project context: `/Users/alcylu/Apps/nightlife-mcp/.planning/PROJECT.md`

---
*Feature research for: VIP generic pricing redesign (nightlife-mcp)*
*Researched: 2026-03-10*
