# External Integrations

**Analysis Date:** 2026-03-10

## APIs & External Services

**Stripe (Payment Processing):**
- Service: Stripe Payments API
- What it's used for: VIP table deposit payments, checkout sessions, refunds
- SDK/Client: `stripe` npm package (v20.4.0)
- Config: `src/services/stripe.ts` - singleton Stripe instance
- Auth: `STRIPE_SECRET_KEY` env var
- Webhook: POST `/stripe/webhook` - handles `checkout.session.completed` and `checkout.session.expired` events
- Webhook auth: `STRIPE_WEBHOOK_SECRET` env var (signature verification)
- Usage files: `src/services/stripe.ts`, `src/services/deposits.ts`, `src/routes/stripeWebhook.ts`, `src/tools/deposits.ts`
- Minimum transaction: ¥50 (JPY)
- Metadata: Includes `booking_request_id` in Stripe session metadata for reconciliation

**Resend (Transactional Email):**
- Service: Resend email delivery API
- What it's used for: VIP booking status emails (submitted, deposit required, confirmed, rejected, cancelled, refunded, link regenerated)
- SDK/Client: `resend` npm package (v4.8.0)
- Config: `src/services/email.ts` - singleton Resend instance
- Auth: `RESEND_API_KEY` env var
- From address: `Nightlife Tokyo VIP <vip@nightlifetokyo.com>`
- Usage files: `src/services/email.ts`, `src/emails/templates.ts`, `src/routes/stripeWebhook.ts`
- Email templates: Located in `src/emails/templates.ts`
- Error handling: Silent failure (logs only, doesn't break operations)

## Data Storage

**Databases:**
- Supabase PostgreSQL (nqwyhdfwcaedtycojslb)
  - Connection: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars
  - Client: `@supabase/supabase-js` (2.97.0)
  - Auth mode: Service role (no session persistence, read-only for API consumers)
  - Tables:
    - `public.cities` - City/timezone definitions
    - `public.venues` - Venue profiles
    - `public.events` - Event listings
    - `public.event_occurrences` - Event instances (date-specific)
    - `public.event_genres` - Event genre tags
    - `public.performers` - Performer profiles
    - `public.concierge_unmet_requests` - Concierge followup backlog
    - `public.vip_booking_requests` - VIP table booking requests
    - `public.vip_table_availability` - Per-date VIP table pricing
    - `public.vip_table_day_defaults` - Day-of-week table pricing templates
    - `public.venue_operating_hours` - Venue open/closed by day
    - `public.vip_table_metadata` - Table descriptions + chart images
    - `public.mcp_api_keys` - API key storage (DB-backed, user-associated)
    - `public.mcp_api_usage_daily` - Daily request quota tracking
    - `public.mcp_api_usage_minute` - Minute-level rate limiting
  - File storage: Supabase Storage bucket `vip-table-charts/` for table chart images
  - Migrations: Applied via `supabase/migrations/` directory
  - RLS (Row-Level Security): Enforced on user-facing tables

**File Storage:**
- Supabase Storage (bucket: `vip-table-charts/`)
  - Purpose: VIP table chart images (venue layouts)
  - Pattern: `{venue_id}/table-chart.{jpg|png|svg}`
  - Access: Public read (via Supabase CDN)

**Caching:**
- None - Direct Supabase queries on every request
- Session state: In-memory Map<sessionId, SessionContext> in `src/http.ts` (per-server, not distributed)

## Authentication & Identity

**API Key Auth:**
- Provider: Custom (Supabase-backed + env var fallback)
- Implementation files: `src/auth/apiKeys.ts`, `src/auth/authorize.ts`, `src/middleware/apiKeyAuth.ts`
- Key format: API keys stored in `public.mcp_api_keys` table or via env vars
- Transport: `x-api-key` header or `Authorization: Bearer <key>`
- DB-backed keys: Tracked with quota (daily/minute limits), user association, tier classification
- Env var fallback: Comma-separated keys in `MCP_HTTP_API_KEYS` (when `MCP_HTTP_USE_DB_KEYS=true` + `MCP_HTTP_ALLOW_ENV_KEY_FALLBACK=true`)
- Verification: Timing-safe hash comparison (SHA-256)
- Rate limits: Set per key in DB or default tier (e.g., `webmcp-browser` tier: free, 500/day, 30/min)

**Admin Dashboard Auth:**
- Provider: Custom (username/password)
- Implementation: `src/admin/dashboardAuth.ts`
- Storage: In-memory via `VIP_DASHBOARD_ADMINS` env var (format: `username:password,username:password`)
- Session: HTTP-only cookie (name: `VIP_DASHBOARD_SESSION_COOKIE_NAME`, TTL: `VIP_DASHBOARD_SESSION_TTL_MINUTES`)
- Scope: VIP admin dashboard at `/ops/vip-dashboard`

## Monitoring & Observability

**Error Tracking:**
- Service: None (no Sentry/error aggregation service configured)
- Logging: Custom event logging via `src/observability/metrics.ts`
- Log destination: console/stderr
- Events logged: http requests, auth results, API calls, email delivery, Stripe events, metrics

**Logs:**
- Approach: Synchronous console logging (stderr for startup messages, metrics)
- Structured events: Exported via `logEvent(eventName, data)` function
- Metrics collection: Runtime stats (tool latency, HTTP request counts) tracked in memory

**Health Check:**
- Endpoint: GET `/health`
- Returns: JSON with uptime, session count, tier distribution, runtime metrics, MCP stats (total users, 24h API calls)
- Non-blocking: DB query failures don't fail health check (returns null for failed fields)

## CI/CD & Deployment

**Hosting:**
- Railway (platform as a service)
- Project ID: `08d1f8fb-4a80-4f48-b1b8-1578d2f8bf0c`
- Production URL: `https://api.nightlife.dev/mcp` (Railway custom domain)
- Public GitHub: `https://github.com/alcylu/nightlife-mcp` (MIT licensed)
- Docker deployment: Multi-stage build, Node 20-slim runtime

**CI Pipeline:**
- GitHub Actions: Standard Node.js build workflow (likely via Railway auto-deploy on push)
- Build command: `npm run build`
- Test command: `npm run test` (uses Node.js native test runner via `tsx --test`)
- Deployment: Automatic on main branch push (Railway integration)

**Environment Configuration:**
- `RAILWAY_TOKEN` for CLI access (kept secure, not in repo)
- Railway web dashboard for secrets management
- Env vars synced to production via Railway UI

## Webhooks & Callbacks

**Incoming (External → MCP):**
- `POST /stripe/webhook` - Stripe payment event handler
  - Events: `checkout.session.completed`, `checkout.session.expired`
  - Signature verification: Stripe webhook signing secret
  - Payload: Raw request body parsed by Stripe SDK

**Outgoing (MCP → External):**
- None configured directly
- Stripe redirects: Success/cancel URLs generated in deposit checkout flow
  - Success: `https://api.nightlife.dev/deposit/success`
  - Cancel: `https://api.nightlife.dev/deposit/cancelled`

## MCP Protocol Integration

**Transport Modes:**
- Stdio (local Claude Desktop): `src/index.ts`
- HTTP (remote/hosted): `src/http.ts` with StreamableHTTPServerTransport
- Both modes share same MCP server instance via `src/server.ts` factory

**Protocol Version:** 2025-06-18

**Tools Registered:**
- Search tools: `search_events`, `search_venues`, `search_performers`
- Detail tools: `get_event_details`, `get_venue_info`, `get_performer_info`
- Metadata tools: `list_cities`, `list_genres`, `list_areas`
- Booking tools: `create_vip_booking_request`, `get_vip_table_availability`, `create_vip_table_booking_deposit`
- Admin tools: `submit_new_vip_booking` (ops tier only), operations/guest list management (ops tier only)
- Logging tool: `log_unmet_request` for concierge analytics
- Recommendations tool: `get_recommendations` (feature-flagged, when `MCP_ENABLE_RECOMMENDATIONS=true`)

---

*Integration audit: 2026-03-10*
