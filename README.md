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

## Implemented (v0.1)

- `search_events`
- `get_tonight`
- `get_event_details`
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
- `MCP_TOP_LEVEL_CITIES` (default: `DEFAULT_CITY`; controls `available_cities` in unsupported-city responses)
- `DEFAULT_COUNTRY_CODE` (default: `JP`)
- `NIGHTLIFE_BASE_URL` (default: `https://nightlifetokyo.com`)
- `MCP_HTTP_REQUIRE_API_KEY` (default: `true`)
- `MCP_HTTP_USE_DB_KEYS` (default: `true`)
- `MCP_HTTP_ALLOW_ENV_KEY_FALLBACK` (default: `true`)
- `MCP_HTTP_API_KEYS` (comma-separated legacy fallback keys)

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

## Notes

- Date handling supports `tonight`, `this_weekend`, `YYYY-MM-DD`, and `YYYY-MM-DD/YYYY-MM-DD`.
- City handling is backed by `public.cities` (`slug`, timezone, and service-day cutoff).
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
- Tool errors are returned as JSON text payloads in `result.content[0].text`:
  - `INVALID_DATE_FILTER`
  - `INVALID_EVENT_ID`
  - `UNSUPPORTED_EVENT_ID`
  - `EVENT_NOT_FOUND`
  - `DB_QUERY_FAILED`
  - `INTERNAL_ERROR`
