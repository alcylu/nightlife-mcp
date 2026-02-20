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
MCP_HTTP_USE_DB_KEYS=true            # DB migration applied 2026-02-19
MCP_HTTP_ALLOW_ENV_KEY_FALLBACK=true # env key still works as fallback
MCP_HTTP_API_KEYS=<comma-separated fallback keys>
```

## DB Migrations
- `supabase/migrations/20260219094000_mcp_api_keys.sql` — API key table + `consume_mcp_api_request` RPC for quota tracking
- `supabase/migrations/20260220_user_api_keys.sql` — Self-service API keys:
  - `user_id` column on `mcp_api_keys` (FK to `auth.users`)
  - RLS on `mcp_api_keys`, `mcp_api_usage_daily`, `mcp_api_usage_minute`
  - RPCs: `create_user_api_key(text)`, `revoke_user_api_key(uuid)`, `get_user_usage_summary()`
  - Max 3 active keys per user, free tier (100/day, 20/min)
  - Applied to production 2026-02-19 via `psql` with `SET ROLE postgres;`
- Create keys (CLI): `npm run key:create -- --name <name> --tier starter --daily-quota 1000 --minute-quota 60`
- Create keys (self-service): Users sign up at nightlife.dev → dashboard auto-creates first key

## Deployment (Railway)
- **Production URL**: `https://api.nightlife.dev/mcp` (Railway: `nightlife-mcp-production.up.railway.app`)
- **Health**: `https://api.nightlife.dev/health`
- **GitHub**: `https://github.com/alcylu/nightlife-mcp` (public, MIT)
- **Railway project**: `nightlife-mcp` (ID: `08d1f8fb-4a80-4f48-b1b8-1578d2f8bf0c`)
- **Production API key**: `nlt-mcp-prod-key-2026-feb` (env-based via `MCP_HTTP_API_KEYS`)
- **Key config**: `MCP_HTTP_USE_DB_KEYS=true` + `MCP_HTTP_ALLOW_ENV_KEY_FALLBACK=true`
- DB keys: self-service via nightlife.dev dashboard (RPCs applied 2026-02-19)
- Env key fallback: `nlt-mcp-prod-key-2026-feb` still works alongside DB keys

## Testing (2026-02-19)
- All tools passing on production (11/11 tests)
- Genre filter fixed: paginated `event_genres` fetch + chunked `.in()` calls (100 IDs per batch)
- See daily log `~/clawd/memory/2026-02-19.md` for full test results

## Health Endpoint
- **URL**: `/health`
- Returns: `{ ok, transport, sessions, tiers, uptime_sec, runtime_metrics, mcp_stats }`
- `mcp_stats`: `{ total_users, api_calls_24h }` — queries `mcp_api_keys` (unique user_ids) and `mcp_api_usage_daily` (24h request_count sum)
- Non-blocking: DB query failures don't break health check (returns null for failed fields)
- Monitored by Cloudflare Workers health-monitor (`~/Apps/health-monitor/`)

## Related Projects
- **nightlife-dev** (`~/Apps/nightlife-dev/`): Developer landing page + self-service dashboard at nightlife.dev
- **health-monitor** (`~/Apps/health-monitor/`): Cloudflare Workers health checker, monitors this server + nightlife-dev

## Hotel Go-to-Market Strategy (2026-02-20 Research)
- **Target market**: Hotel AI concierge platforms need real-time nightlife/event data
- **Key insight**: HFTP declared "2026 is the year of MCP" — hotels actively adopting
- **No competitor** provides structured nightlife data via MCP to hotels
- **Targets**: Tokyo luxury hotels (direct), Apaleo Agent Hub, Mindtrip, Canary, Sabre/Amadeus
- **Pricing**: $199/mo starter, $499/mo professional, custom enterprise
- **Research reports**: `~/clawd/memory/meetings/2026-02-20-hotel-ai-concierge-market-research.md`, `~/clawd/memory/meetings/2026-02-20-mcp-hospitality-adoption.md`, `~/clawd/memory/2026-02-20-hotel-tech-pricing-research.md`

## Planned (not yet built) — Prioritized for Hotel Readiness
### P0 (Hotel-Critical)
- REST API endpoints (same auth/data as MCP — universal fallback for 90%+ of integrations)
- `get_recommendations` tool (THE hotel question: "what should I do tonight?")

### P1
- `search_venues`, `get_venue_details`
- `list_genres`, `list_areas`, `list_cities`
- OpenAPI spec + hosted docs
- Publish on mcp.so + Apaleo Agent Hub

### P2
- `search_performers`, `get_performer_profile`
- Hotel-optimized response formatting (concierge-friendly language, safety/vibe info)
- Multi-city expansion (next 5 cities after Tokyo)
- Hotel concierge dashboard (separate frontend)
