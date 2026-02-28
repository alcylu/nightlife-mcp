# nightlife-mcp

MCP server for nightlife event discovery backed by Supabase.

## Quick Start

**Production endpoint:** `https://api.nightlife.dev/mcp`

1. Get a free API key at [nightlife.dev](https://nightlife.dev)
2. Add to Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "nightlife": {
      "url": "https://api.nightlife.dev/mcp",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}
```

For curl, TypeScript SDK, and other clients, see [`CLIENT_SETUP.md`](CLIENT_SETUP.md).

## Implemented (v0.3)

- `search_events`
- `get_tonight`
- `get_event_details`
- `search_venues`
- `get_venue_info`
- `search_performers`
- `get_performer_info`
- `log_unmet_request`
- `create_vip_booking_request`
- `get_vip_booking_status`
- `get_vip_table_availability`
- `get_vip_table_chart`
- `get_recommendations` (v0.2, behind `MCP_ENABLE_RECOMMENDATIONS=true`)
- Streamable HTTP endpoint with API-key middleware
- Structured tool output schemas (`outputSchema`)
- Deterministic tool error payloads with stable error codes
- Runtime request/tool metrics exposed at `/health`

## Prerequisites

- Node.js 18+
- Supabase project URL + service role key

## Setup

```bash
cp .env.example .env
npm install
```

Set env vars in `.env`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `DEFAULT_CITY` (default: `tokyo`)
- `MCP_TOP_LEVEL_CITIES` (default example: `tokyo,san-francisco`; controls `available_cities` in unsupported-city responses)
- `DEFAULT_COUNTRY_CODE` (default: `JP`)
- `NIGHTLIFE_BASE_URL` (default: `https://nightlifetokyo.com`)
- `MCP_HTTP_REQUIRE_API_KEY` (default: `true`)
- `MCP_HTTP_USE_DB_KEYS` (default: `true`)
- `MCP_HTTP_ALLOW_ENV_KEY_FALLBACK` (default: `true`)
- `MCP_HTTP_API_KEYS` (comma-separated legacy fallback keys)
- `MCP_ENABLE_RECOMMENDATIONS` (default: `false`; enables `get_recommendations`)

## DB API Key Mode (Recommended)

HTTP authentication can use persistent API keys from Supabase plus quota tracking.

1) Run SQL migration in your Supabase SQL editor:

```sql
-- copy file contents from:
-- supabase/migrations/20260219094000_mcp_api_keys.sql
```

2) Ensure DB auth flags are enabled in `.env`:

```bash
MCP_HTTP_REQUIRE_API_KEY=true
MCP_HTTP_USE_DB_KEYS=true
MCP_HTTP_ALLOW_ENV_KEY_FALLBACK=true
```

3) Create an API key record:

```bash
npm run key:create -- --name claude-desktop --tier starter --daily-quota 1000 --minute-quota 60
```

This prints the raw `api_key` once. Save it securely and use it in MCP HTTP calls.

If the DB RPC is unavailable, fallback to `MCP_HTTP_API_KEYS` works only when `MCP_HTTP_ALLOW_ENV_KEY_FALLBACK=true`.

## Concierge Unmet Request Backlog

Public concierge flows can log unsupported user intents to Supabase.

Run migration:

```sql
-- copy file contents from:
-- supabase/migrations/20260226_concierge_unmet_requests.sql
```

Then call MCP tool `log_unmet_request` when no good answer exists from available nightlife data.

## VIP Booking Phase 1

VIP table booking submission and status tracking are backed by Supabase.

Run migration:

```sql
-- copy file contents from:
-- supabase/migrations/20260227143000_vip_phase1_requests_and_queue.sql
-- supabase/migrations/20260228124500_add_vip_booking_enabled_to_venues.sql
-- and if already deployed before 2026-02-28:
-- supabase/migrations/20260228111000_vip_outward_language_defaults.sql
-- supabase/migrations/20260301010000_vip_table_availability_chart.sql
```

Then call MCP tools:
- `create_vip_booking_request`
- `get_vip_booking_status`
- `get_vip_table_availability` (read per-day table availability by venue/date range)
- `get_vip_table_chart` (read structured table chart with optional per-date status overlay)

Ops-tier sessions also have internal queue tools:
- `list_vip_reservations` (all outstanding reservations; default statuses: `submitted`, `in_review`, `confirmed`)
- `list_vip_requests_for_alerting` (due alerts only)
- `mark_vip_request_alert_sent`
- `claim_vip_request_after_ack`
- `update_vip_booking_status` (set `confirmed`/`rejected`/`cancelled` with audit event)
- `upsert_vip_venue_tables` (write venue table definitions + chart coordinates)
- `upsert_vip_table_availability` (write per-date table statuses)

To discover bookable venues first, use:
- `search_venues` with `vip_booking_supported_only=true`
- or `get_venue_info` and check `vip_booking_supported`

For internal venue-booking workers, claim queue tasks via DB function:
- `public.claim_next_vip_agent_task(p_agent_id text)`

## Run

Stdio (local desktop clients):

```bash
npm run dev
```

Streamable HTTP:

```bash
npm run dev:http
```

For production build:

```bash
npm run build
npm start
```

For HTTP in production:

```bash
npm run start:http
```

Debug web UI for recommendations:

```bash
MCP_ENABLE_RECOMMENDATIONS=true npm run dev:http
# open http://127.0.0.1:3000/debug/recommendations
```

## Notes

- Date handling supports `tonight`, `this_weekend`, `YYYY-MM-DD`, and `YYYY-MM-DD/YYYY-MM-DD`.
- `get_recommendations` returns up to 10 diverse modal slots with dynamic city-aware fallback.
- Venue and performer tools include upcoming events snapshots.
- `log_unmet_request` writes unresolved user asks to `public.concierge_unmet_requests`.
- VIP phase 1 writes booking submissions to `public.vip_booking_requests` and worker queue tasks to `public.vip_agent_tasks`.
- VIP inventory writes table definitions to `public.vip_venue_tables` and date-specific statuses to `public.vip_table_availability`.
- `search_venues` and `get_venue_info` include `vip_booking_supported` so clients can show exactly which venues accept VIP booking submissions.
- `vip_booking_supported` is sourced from `public.venues.vip_booking_enabled` (separate from `guest_list_enabled`).
- `create_vip_booking_request` only accepts venues where `vip_booking_supported=true`.
- City handling is backed by `public.cities` (`slug`, timezone, and service-day cutoff).
- Supported top-level cities are environment-configurable (for example `tokyo` and `san-francisco`) while Tokyo can remain the default.
- Stdio transport: no API key check.
- HTTP transport (`/mcp`): API key required by default (`MCP_HTTP_REQUIRE_API_KEY=true`).
- API key headers:
  - `Authorization: Bearer <key>`
  - `x-api-key: <key>`
- HTTP responses include key tier/source and rate-limit headers when DB-backed auth is active:
  - `X-API-Key-Tier`
  - `X-API-Key-Source`
  - `X-RateLimit-Daily-Limit`
  - `X-RateLimit-Daily-Remaining`
  - `X-RateLimit-Minute-Limit`
  - `X-RateLimit-Minute-Remaining`
- Health endpoint: `/health`.
- Debug page for manual tool testing: `/debug/recommendations`.
- Tool errors are returned as JSON text payloads in `result.content[0].text`:
  - `INVALID_DATE_FILTER`
  - `INVALID_EVENT_ID`
  - `UNSUPPORTED_EVENT_ID`
  - `EVENT_NOT_FOUND`
  - `INVALID_VENUE_ID`
  - `VENUE_NOT_FOUND`
  - `INVALID_PERFORMER_ID`
  - `PERFORMER_NOT_FOUND`
  - `INVALID_BOOKING_REQUEST`
  - `BOOKING_REQUEST_NOT_FOUND`
  - `BOOKING_STATUS_UPDATE_FAILED`
  - `VIP_TASK_NOT_AVAILABLE`
  - `VIP_ALERT_UPDATE_FAILED`
  - `VIP_CLAIM_FAILED`
  - `INVALID_REQUEST`
  - `REQUEST_WRITE_FAILED`
  - `DB_QUERY_FAILED`
  - `INTERNAL_ERROR`
