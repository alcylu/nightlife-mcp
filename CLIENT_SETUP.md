# Client Setup Guide

This guide shows how to connect clients to `nightlife-mcp`.

## 1) Prerequisites

- Project path: `/Users/alcylu/Apps/nightlife-mcp`
- Install deps and build:

```bash
cd /Users/alcylu/Apps/nightlife-mcp
npm install
npm run build
```

- For HTTP mode, ensure `.env` is configured with:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `MCP_HTTP_REQUIRE_API_KEY=true`
  - `MCP_HTTP_USE_DB_KEYS=true`

## 2) Claude Desktop (stdio)

Stdio mode does not require API keys.

Add this to your Claude Desktop MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "nightlife-mcp": {
      "command": "node",
      "args": [
        "/Users/alcylu/Apps/nightlife-mcp/dist/index.js"
      ],
      "cwd": "/Users/alcylu/Apps/nightlife-mcp",
      "env": {
        "SUPABASE_URL": "https://<your-project-ref>.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "<your-service-role-key>",
        "DEFAULT_CITY": "tokyo",
        "DEFAULT_COUNTRY_CODE": "JP",
        "NIGHTLIFE_BASE_URL": "https://nightlifetokyo.com"
      }
    }
  }
}
```

Restart Claude Desktop after saving config.

## 3) HTTP Clients (Remote MCP)

Start server:

```bash
cd /Users/alcylu/Apps/nightlife-mcp
npm run start:http
```

Default endpoint:

- `http://127.0.0.1:3000/mcp`

Required headers:

- `Accept: application/json, text/event-stream`
- `x-api-key: <your-db-api-key>` (or `Authorization: Bearer <key>`)

## 4) ChatGPT-Compatible MCP HTTP Setup

For MCP clients that use remote HTTP (including ChatGPT MCP connector flows), use:

- URL: `http://127.0.0.1:3000/mcp` (or your deployed HTTPS URL)
- Header: `x-api-key: <your-db-api-key>`
- Accept header must include: `application/json, text/event-stream`

If your connector UI supports custom headers, add `x-api-key` there.

## 5) Quick Verification

Initialize:

```bash
curl -i http://127.0.0.1:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'x-api-key: <your-db-api-key>' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0.0"}}}'
```

From the response, copy `mcp-session-id`, then call a tool:

```bash
curl -i http://127.0.0.1:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'x-api-key: <your-db-api-key>' \
  -H 'mcp-session-id: <session-id>' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_tonight","arguments":{"city":"tokyo","limit":5}}}'
```

## 6) Common Errors

- `401 API key required`: missing key header in HTTP mode.
- `403 Invalid API key`: key is wrong/revoked.
- `400/406 on initialize`: missing `Accept: application/json, text/event-stream`.
- Session mismatch errors: use same API key for all requests in a session.
