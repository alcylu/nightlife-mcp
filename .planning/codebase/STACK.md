# Technology Stack

**Analysis Date:** 2026-03-10

## Languages

**Primary:**
- TypeScript 5.9.3 - Entire codebase, compiled to ES2022

## Runtime

**Environment:**
- Node.js >=20

**Package Manager:**
- npm
- Lockfile: package-lock.json (present)

## Frameworks

**Core:**
- @modelcontextprotocol/sdk 1.26.0 - MCP server implementation
- Express 5.2.1 - HTTP server for streaming transport + REST API
- @scalar/express-api-reference 0.8.46 - Interactive API docs (Scalar at `/api/v1/docs`)

**Build/Dev:**
- tsx 4.21.0 - TypeScript execution (dev scripts)
- TypeScript 5.9.3 - Compilation (tsc)

## Key Dependencies

**Critical:**
- @supabase/supabase-js 2.97.0 - Database client (PostgreSQL via Supabase)
- zod 4.3.6 - Runtime schema validation (config parsing, request validation)

**Payment & Transactions:**
- stripe 20.4.0 - Payment processing (Checkout sessions, deposits, refunds)

**Email:**
- resend 4.8.0 - Transactional email delivery (VIP booking confirmations)

**Utilities:**
- cors 2.8.6 - CORS middleware for REST API (`/api/v1` routes)
- date-fns-tz 3.2.0 - Timezone-aware date handling (service-day calculations, JST timezone)
- dotenv 17.3.1 - Environment variable loading (`.env` file support)

**Type Definitions:**
- @types/cors 2.8.19
- @types/express 5.0.6
- @types/node 25.3.0

## Configuration

**Environment:**
- Loaded from `.env` file via `dotenv`
- Validated at startup with Zod schema in `src/config.ts`
- Config type: `AppConfig` exported from `src/config.ts`

**Required Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Database service role key (read-only, credential restricted)
- `STRIPE_SECRET_KEY` - Stripe API secret key (optional, for VIP deposits)
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret (optional)
- `RESEND_API_KEY` - Resend email service API key (optional, for VIP emails)
- `HTTP_PORT` / `PORT` - HTTP server port (defaults to 3000)
- `HTTP_HOST` - HTTP server host (defaults to 0.0.0.0)
- `MCP_HTTP_REQUIRE_API_KEY` - Enforce API key auth on HTTP (default: true)
- `MCP_HTTP_USE_DB_KEYS` - Enable database-backed API key tracking (default: true)
- `MCP_HTTP_ALLOW_ENV_KEY_FALLBACK` - Allow env var API keys as fallback (default: true)
- `MCP_HTTP_API_KEYS` - Comma-separated fallback API keys (for env var auth)
- `MCP_ENABLE_RECOMMENDATIONS` - Feature flag for recommendations engine (default: false)
- `VIP_DASHBOARD_ADMINS` - Comma-separated username:password pairs for admin login
- `VIP_DASHBOARD_SESSION_TTL_MINUTES` - Admin session timeout (default: 720)

**Build:**
- `tsconfig.json` - TypeScript compilation to ES2022, CommonJS-style imports via `NodeNext`
- Compiled output: `dist/` directory
- Entry points: `dist/index.js` (stdio), `dist/http.js` (HTTP server)

## Platform Requirements

**Development:**
- Node.js 20+
- npm for dependency management
- `.env` file (see config vars above)

**Production:**
- Node.js 20-slim Docker image
- Railway deployment (nightly builds, auto-restart)
- Production URL: `https://api.nightlife.dev/mcp` (managed via Railway)
- Health check: GET `/health` → JSON status response

## Database

**Primary:**
- Supabase PostgreSQL instance
- Project: `nqwyhdfwcaedtycojslb`
- Authentication: Service role key (not user-based)
- Migrations: `supabase/migrations/` directory
- Tables: `vip_booking_requests`, `vip_table_availability`, `mcp_api_keys`, `mcp_api_usage_daily`, `mcp_api_usage_minute`, etc.

## Build & Deployment

**Build:**
```bash
npm run build  # TypeScript → dist/
```

**Local Development:**
```bash
npm run dev        # Stdio transport (Claude Desktop)
npm run dev:http   # HTTP transport (localhost:3000)
```

**Production:**
```bash
npm run build && npm start:http  # Docker entrypoint
```

**Docker:**
- Multi-stage build (builder + runtime)
- Node 20-slim base image
- Exposes port 3000 (or $PORT env var)
- Entrypoint: `node dist/http.js`

---

*Stack analysis: 2026-03-10*
