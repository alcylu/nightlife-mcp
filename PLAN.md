# nightlife-mcp — Execution Plan

Updated: February 19, 2026

## Goal

Build an MCP server that gives AI agents reliable nightlife event discovery data, starting with Tokyo and expanding city-by-city.

## Current Status

Phase-1 and core Phase-2 are implemented in this repo:

- TypeScript MCP server (stdio transport)
- Streamable HTTP MCP server (`/mcp`)
- Supabase integration
- Core tools:
  - `search_events`
  - `get_tonight`
  - `get_event_details`
- API-key middleware for HTTP transport
- DB-backed API keys with per-minute and daily quota enforcement (with optional env fallback)

See implementation under `/Users/alcylu/Apps/nightlife-mcp/src`.

## Resolved Architecture Decisions

### 1) Data Plane vs Control Plane

Previous contradiction: "read-only Supabase" while also requiring writes (API keys, waitlist, usage, anti-abuse).

Locked model:

- Data plane (event content): read-only access to event tables.
- Control plane (product ops): write-enabled tables for:
  - API keys
  - usage logs
  - rate-limit counters
  - city waitlist
  - abuse flags

This can be in the same Supabase project (recommended) but logically separated.

### 2) City-Time Logic

Previous contradiction: global city support with JST-only rollover rules.

Locked model:

- Service-day logic is city-specific, using `public.cities.timezone` and `public.cities.service_day_cutoff_time`.
- "Tonight" means current city service date.
- Date windows are computed in city local time then converted to UTC for DB filtering.

### 3) Event Identifier Contract

Previous risk: strict UUID assumption without acknowledging virtual IDs.

Locked model:

- v1 accepts concrete event occurrence IDs (UUID).
- `virtual:*` IDs are reserved for later virtual-event support and currently return a clear error.
- API responses should include a stable `event_id` that maps to `event_occurrences.id`.

### 4) MCP Auth by Transport

Previous gap: "same key for MCP + REST" without transport-specific rules.

Locked model:

- `stdio` (local desktop clients): no API key required in v1.
- Remote HTTP/SSE/Streamable HTTP: API key required per request/session.
- REST and remote MCP share same API key model and quota ledger.

## v1 Tool Contract (Implemented)

### `search_events`

Parameters:

- `city` (default `tokyo`)
- `date`: `tonight`, `this_weekend`, `YYYY-MM-DD`, `YYYY-MM-DD/YYYY-MM-DD`
- `genre`
- `area`
- `query`
- `limit` (1-20, default 10)
- `offset` (default 0)

Returns:

- city metadata
- event summaries
- unavailable-city payload when city is unsupported

### `get_tonight`

Parameters:

- `city` (default `tokyo`)
- `genre`
- `area`
- `limit`, `offset`

Returns:

- same structure as `search_events` with `date = tonight`.

### `get_event_details`

Parameters:

- `event_id` (UUID in v1)

Returns:

- event core fields
- venue + map link
- lineup
- genres
- pricing summary + ticket tiers
- guest list status (`available` | `full` | `closed`)
- canonical website URL

## Data Mapping Notes

Primary sources:

- `event_occurrences`
- `event_occurrence_days`
- `venues`
- `event_genres` + `genres`
- `event_media`
- `event_stages` + `event_timetables` + `performers`
- `event_ticket_tiers`
- `event_guest_list_settings`
- `event_guest_list_entries`
- `cities`

## Out of Scope for v1

- Write actions (guest list submission, event mutation)
- Billing/Stripe integration
- Enterprise automation flows
- Full anti-scraping ML/rule engine

## Next Implementation Steps

### Step 1: Hardening (1-2 days)

- Implemented:
  - structured output schemas for all tools
  - runtime metrics + request logging
  - deterministic tool error codes

### Step 2: Access Controls (2-3 days)

- Implemented for MCP HTTP:
  - persistent API key store (`public.mcp_api_keys`)
  - rate limits (per-minute + daily via `consume_mcp_api_request`)
  - env-key fallback controls for phased rollout
- Pending:
  - shared quota accounting between MCP and REST (REST side not yet wired)

### Step 3: Product Controls (2-3 days)

- Add control-plane schema for keys/usage/waitlist/abuse events.
- Add city-waitlist endpoint and MCP response wiring.

### Step 4: Docs + Launch (1-2 days)

- Final README with setup examples for Claude Desktop and ChatGPT.
- Publish server package/repo + directory listing submission.

## Repository Layout

```
/Users/alcylu/Apps/nightlife-mcp/
├── PLAN.md
├── README.md
├── package.json
├── tsconfig.json
├── .env.example
└── src/
    ├── index.ts
    ├── server.ts
    ├── config.ts
    ├── types.ts
    ├── db/
    │   └── supabase.ts
    ├── services/
    │   ├── cities.ts
    │   └── events.ts
    ├── tools/
    │   └── events.ts
    └── utils/
        └── time.ts
```
