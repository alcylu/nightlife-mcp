# Client Setup Guide

Production endpoint: `https://api.nightlife.dev/mcp`

Get a free API key at [nightlife.dev](https://nightlife.dev).

## Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

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

Restart Claude Desktop after saving.

## curl

Initialize a session:

```bash
curl -i https://api.nightlife.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'x-api-key: YOUR_API_KEY' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0.0"}}}'
```

Copy the `mcp-session-id` from the response headers, then call a tool:

```bash
curl -i https://api.nightlife.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'x-api-key: YOUR_API_KEY' \
  -H 'mcp-session-id: SESSION_ID' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_tonight","arguments":{"city":"tokyo","limit":5}}}'
```

Example venue search call:

```bash
curl -i https://api.nightlife.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'x-api-key: YOUR_API_KEY' \
  -H 'mcp-session-id: SESSION_ID' \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_venues","arguments":{"city":"tokyo","genre":"techno","limit":5}}}'
```

## TypeScript SDK

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://api.nightlife.dev/mcp"),
  { requestInit: { headers: { "x-api-key": "YOUR_API_KEY" } } }
);

const client = new Client({ name: "my-app", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool({
  name: "get_tonight",
  arguments: { city: "san-francisco", limit: 5 }
});
```

## Available Tools

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
- `get_recommendations` (when `MCP_ENABLE_RECOMMENDATIONS=true`)

VIP booking support visibility:
- `search_venues` returns `vip_booking_supported` per venue and accepts optional `vip_booking_supported_only`
- `get_venue_info` returns `vip_booking_supported`
- `vip_booking_supported` is driven by the dedicated venue flag `vip_booking_enabled` (not `guest_list_enabled`)

VIP booking conversation policy (`create_vip_booking_request`):
- Confirm booking date/time in venue local time before tool call.
- Use dual-date wording to avoid after-midnight confusion.
- For `00:00`-`05:59` arrivals, explicitly include next calendar day.
- Required template:
  - `Just to confirm: you want a table for [Night Day] night ([Night Date]), arriving around [Time] on [Arrival Day], [Arrival Date] ([Timezone]). I'll submit that as [Night Day] night with [Time] arrival. Is that correct?`
- If user gives only `2am` without day:
  - `Do you mean 2:00 AM after Thursday night (Friday morning), or after Friday night (Saturday morning)?`

## Authentication

All HTTP requests require an API key via one of:
- `x-api-key: YOUR_API_KEY` header
- `Authorization: Bearer YOUR_API_KEY` header

Responses include rate-limit headers:
- `X-RateLimit-Daily-Limit` / `X-RateLimit-Daily-Remaining`
- `X-RateLimit-Minute-Limit` / `X-RateLimit-Minute-Remaining`

## Common Errors

| Status | Meaning |
|--------|---------|
| `401` | Missing API key header |
| `403` | Invalid or revoked API key |
| `400/406` | Missing `Accept: application/json, text/event-stream` header |

## Local Development

If running the server locally (for contributors):

```bash
cp .env.example .env   # configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev:http       # starts at http://127.0.0.1:3000/mcp
```
