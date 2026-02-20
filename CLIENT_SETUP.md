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
  arguments: { city: "tokyo", limit: 5 }
});
```

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
