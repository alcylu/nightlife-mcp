# nightlife-mcp — Technical Spec

## Overview
Open-source MCP server for nightlife event discovery. First nightlife MCP server among 17,744+ on mcp.so.

- **Stack**: TypeScript, `@modelcontextprotocol/sdk`, Express, Supabase (shared DB with nightlife-tokyo-next)
- **Location**: `~/Apps/nightlife-mcp/`
- **Supabase Project**: `nqwyhdfwcaedtycojslb` (same as consumer site, read-only access)
- **License**: MIT (open source code, private data)

## Running

```bash
# Stdio (local Claude Desktop)
npm run dev

# HTTP (remote clients)
npm run dev:http     # → http://127.0.0.1:3000/mcp

# Production
npm run build && npm start:http
```

## Tools (v0.1)

| Tool | Description | Params |
|------|-------------|--------|
| `search_events` | Search events with filters | city, date, genre, area, query, limit, offset |
| `get_tonight` | Tonight's events (service-day aware) | city, genre, area, limit, offset |
| `get_event_details` | Full event detail by UUID | event_id |

### Date Filters
- `tonight` — uses 6am JST rollover (at 2am Saturday, "tonight" = Friday night)
- `this_weekend` — Friday through Sunday
- `YYYY-MM-DD` — specific date
- `YYYY-MM-DD/YYYY-MM-DD` — date range

### City Handling
- Defaults to `tokyo`
- Unknown cities return `unavailable_city` with available cities list + request URL
- Cities resolved from `public.cities` table (slug, timezone, cutoff time)

## Auth

- **Stdio**: no auth
- **HTTP**: API key required via `x-api-key` header or `Authorization: Bearer <key>`
- **Modes**: DB-backed keys (with quota tracking) or env-var fallback keys
- **Rate limit headers**: `X-RateLimit-Daily-Limit`, `X-RateLimit-Daily-Remaining`, `X-RateLimit-Minute-Limit`, `X-RateLimit-Minute-Remaining`

## Architecture

```
src/
├── index.ts          # Stdio entry point
├── http.ts           # Express HTTP entry point (streamable HTTP transport)
├── server.ts         # MCP server factory (registers tools)
├── config.ts         # Zod-validated env config
├── errors.ts         # NightlifeError class + error codes
├── types.ts          # Shared TypeScript types
├── auth/
│   ├── apiKeys.ts    # Key extraction, hashing, timing-safe compare
│   └── authorize.ts  # DB RPC auth + env fallback
├── db/
│   └── supabase.ts   # Supabase client factory
├── services/
│   ├── events.ts     # Event search + detail queries (main business logic)
│   └── cities.ts     # City context resolution
├── tools/
│   └── events.ts     # MCP tool registration + output schemas
├── utils/
│   └── time.ts       # Service-day logic, date parsing, timezone conversion
├── scripts/
│   └── createApiKey.ts  # CLI script to create DB API keys
└── observability/
    └── metrics.ts    # Runtime metrics (tool latency, HTTP stats)
```

## Known Issues (Resolved)

### Genre filter (FIXED 2026-02-19)
- **Was**: `resolveGenreEventIds()` hit Supabase 1000-row cap + URL length limit on `.in()` with 900+ IDs
- **Fix**: Paginated `event_genres` fetch (avoids 1000-row truncation) + chunked `.in()` calls (100 IDs per chunk) via `fetchOccurrencesByIds()`. Metadata fetch also chunked.
- **Note**: PostgREST can't join `event_occurrences` to `event_genres` directly (no FK). The two-step approach (resolve IDs → fetch occurrences) is required.

## Env Vars

```
SUPABASE_URL=https://nqwyhdfwcaedtycojslb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Railway nlt-admin project>
SERVER_NAME=nightlife-mcp
SERVER_VERSION=0.1.0
DEFAULT_CITY=tokyo
DEFAULT_COUNTRY_CODE=JP
NIGHTLIFE_BASE_URL=https://nightlifetokyo.com
HTTP_HOST=127.0.0.1
HTTP_PORT=3000
MCP_HTTP_REQUIRE_API_KEY=true
MCP_HTTP_USE_DB_KEYS=false          # true when DB migration applied
MCP_HTTP_ALLOW_ENV_KEY_FALLBACK=true
MCP_HTTP_API_KEYS=<comma-separated fallback keys>
```

## DB Migration
- `supabase/migrations/20260219094000_mcp_api_keys.sql` — API key table + `consume_mcp_api_request` RPC for quota tracking
- Create keys: `npm run key:create -- --name <name> --tier starter --daily-quota 1000 --minute-quota 60`

## Testing (2026-02-19)
Tested via curl against HTTP transport. All tools pass except genre filter.
See daily log `~/clawd/memory/2026-02-19.md` for full test results.

## Planned (not yet built)
- `search_performers`, `get_performer_profile`
- `search_venues`, `get_venue_details`
- `get_recommendations`
- `list_genres`, `list_areas`, `list_cities`
- REST API endpoints (same auth/data)
- Hotel concierge dashboard (separate frontend)
