# Agents context — nightlife-mcp

Read by AI coding agents (OpenAI Codex, Cursor) before making changes. Mirrors load-bearing parts of `CLAUDE.md`.

## What this repo is

MCP (Model Context Protocol) server. Exposes read-only Supabase queries (events, venues, performers, genres, areas) as MCP tools. Consumed by Claude Desktop and the WebMCP integration on `nightlife` (consumer site). Stack: Node + TypeScript.

## Non-negotiable rules

1. **Every bug fix ships with a regression test** in `npm test`. No exceptions.
2. **Every new MCP tool gets at least one test** covering response shape and auth/error cases.
3. **Do not break the existing tool surface** without coordinating with `nightlife` (consumer site) and `nlt-admin` — both consume tools from this server.

## Useful commands

```sh
npm install   # also activates pre-push hook
npm run dev   # local server
npm test      # run all tests
npm run build # production build
```

## When you finish

1. `npm test` passes locally.
2. Push (pre-push hook runs `npm test` again).
3. PR or direct merge to `main`.

Architecture: `CLAUDE.md` is the source of truth.
