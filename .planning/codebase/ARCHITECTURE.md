# Architecture

**Analysis Date:** 2025-03-10

## Pattern Overview

**Overall:** Layered MCP server with dual transport (stdio + HTTP)

**Key Characteristics:**
- Model Context Protocol (MCP) server abstraction with pluggable transports
- Request-response tool pattern with Zod schema validation
- Multi-layered separation: transport → tools → services → database queries
- Shared service layer between REST API v1 and MCP tools
- API key authentication with rate limiting (daily + minute quotas)
- Error handling with custom NightlifeError codes and HTTP status mapping

## Layers

**Transport Layer:**
- Purpose: Handle client communication (stdio or HTTP)
- Location: `src/index.ts` (stdio), `src/http.ts` (HTTP)
- Contains: Express app setup, session management, MCP transport initialization
- Depends on: server factory, middleware, routes
- Used by: External MCP clients (Claude Desktop, custom HTTP clients)

**Request Handler Layer:**
- Purpose: Accept and dispatch requests to appropriate handlers
- Location: `src/http.ts` (HTTP routes), MCP server itself (tool calls)
- Contains: Express route handlers, middleware chain, request authentication
- Depends on: REST router, Admin router, MCP server tools
- Used by: HTTP clients, MCP clients

**Tool Registration Layer:**
- Purpose: Define MCP tool interfaces and register handlers with MCP server
- Location: `src/tools/*.ts` (one file per tool domain)
- Contains: Tool schemas (Zod), tool call handlers, output formatting
- Depends on: Services, errors, observability
- Used by: MCP server during tool initialization
- Key files: `src/tools/events.ts`, `src/tools/vipBookings.ts`, `src/tools/vipTables.ts`, `src/tools/vipAgentOps.ts`, `src/tools/helpers.ts`

**Service Layer:**
- Purpose: Business logic for domain entities (events, venues, performers, bookings, etc.)
- Location: `src/services/*.ts`
- Contains: Query construction, data transformation, validation, orchestration
- Depends on: Database client (Supabase), utilities (time, features), types
- Used by: Tools, REST router, Admin router
- Key files: `src/services/events.ts`, `src/services/venues.ts`, `src/services/performers.ts`, `src/services/vipBookings.ts`, `src/services/recommendations.ts`, `src/services/vipTables.ts`, `src/services/vipAdmin.ts`, `src/services/deposits.ts`

**Database Layer:**
- Purpose: Supabase client initialization
- Location: `src/db/supabase.ts`
- Contains: Single client factory function
- Depends on: Config (credentials)
- Used by: Services, auth middleware, health endpoint

**Middleware Layer:**
- Purpose: Cross-cutting concerns (auth, logging, validation)
- Location: `src/middleware/apiKeyAuth.ts` (shared by REST + MCP), `src/admin/dashboardAuth.ts` (admin session)
- Contains: Authentication, rate limit header injection, request tracking
- Depends on: Auth logic, observability
- Used by: Express app

**REST API Router:**
- Purpose: Plain JSON REST endpoints for same data as MCP tools
- Location: `src/rest.ts`
- Contains: GET endpoints for `/api/v1/*` paths
- Depends on: Services (reuses them), error formatting
- Used by: HTTP clients (browser, Node.js, webhooks)

**Admin Dashboard:**
- Purpose: VIP booking management interface + dashboard login
- Location: `src/admin/vipAdminRouter.ts` (routes), `src/admin/dashboardAuth.ts` (session), `src/admin/vipDashboardPage.ts` (HTML rendering)
- Contains: VIP booking CRUD, table ops, deposit management, admin authentication
- Depends on: Services, admin-specific logic, Stripe/Resend integration
- Used by: Dashboard users (authenticated)

**Auth & Authorization:**
- Purpose: API key validation and quota tracking
- Location: `src/auth/apiKeys.ts` (extraction), `src/auth/authorize.ts` (validation)
- Contains: API key parsing from headers, hash comparison, DB RPC calls, quota lookup
- Depends on: Supabase
- Used by: Middleware (shared by REST + MCP), HTTP handlers

**Configuration:**
- Purpose: Environment variable parsing and validation
- Location: `src/config.ts`
- Contains: Zod schema for all env vars, typed config object
- Depends on: None (env only)
- Used by: index.ts, http.ts, all servers/factories

**Error Handling:**
- Purpose: Custom error codes and HTTP status mapping
- Location: `src/errors.ts`
- Contains: NightlifeError class, error-to-HTTP-status mapping, error response formatting
- Depends on: None
- Used by: Services, tools, REST router, handlers

**Observability:**
- Purpose: Runtime metrics and event logging
- Location: `src/observability/metrics.ts`
- Contains: Tool call counters, HTTP request stats, unmet request tracking, event logging
- Depends on: None
- Used by: Tools, HTTP middleware, handlers

**Utilities:**
- Purpose: Shared cross-cutting logic
- Location: `src/utils/time.ts` (service-day logic), `src/utils/recommendationFeatures.ts` (recommendation scoring)
- Contains: Timezone-aware date parsing, service day cutoff logic, recommendation feature extraction
- Depends on: date-fns-tz
- Used by: Services

**Types:**
- Purpose: Shared TypeScript interfaces
- Location: `src/types.ts`
- Contains: EventSummary, EventDetail, Venue, Performer, VipBooking, etc. response types
- Depends on: None
- Used by: Services, tools, tests

## Data Flow

**Event Search (Shared by MCP + REST):**

1. Client sends search request (city, date, genre, area, query, limit)
2. Tool handler or REST endpoint extracts parameters
3. Calls `searchEvents()` from `src/services/events.ts`
4. Service validates city, resolves date filter to UTC window, looks up genre IDs (chunked fetch to avoid PostgREST limits)
5. Constructs Supabase query for event occurrences + venues + genres + performers + media + pricing
6. Applies limit/offset pagination
7. Transforms rows to EventSummary format
8. Returns with city context and date_filter label
9. Tool formats as JSON text, REST returns JSON directly

**VIP Booking Request:**

1. Client calls `create_vip_booking_request` tool or POST `/api/v1/admin/vip-bookings`
2. Tool handler validates inputs (party size, email, phone format)
3. Calls `createVipBookingRequest()` from `src/services/vipBookings.ts`
4. Service inserts row into `vip_booking_requests` table
5. Looks up 4-level pricing fallback (exact date → day-of-week template → venue default → unknown)
6. Returns booking ID + status + min_spend + currency
7. If venue has deposit config, creates Stripe session + `vip_deposits` record (optional)
8. Sends transactional email via Resend (if API key configured)
9. Returns VipBookingCreateResult to client

**VIP Admin Dashboard:**

1. Admin logs in at `/ops/login` with username:password
2. Dashboard auth creates session cookie (TTL 12h default)
3. GET `/ops/vip-dashboard` requires valid session cookie
4. Page HTML renders interactive dashboard with fetch-based API calls
5. Dashboard calls POST/PATCH `/api/v1/admin/vip-bookings` with auth header
6. Admin router middleware validates session, extracts username for audit trail
7. Service methods update booking status, notes, or pricing
8. Audit trail recorded in `vip_booking_audits` table
9. Notifications sent to customer via email (status change, deposit link, etc.)

**Recommendation Generation:**

1. Client calls `get_recommendations` with city, date, area, genre, query, limit
2. Tool handler calls `getRecommendations()` from `src/services/recommendations.ts`
3. Service performs two-step feature extraction:
   - For each event, compute modal slots (early/prime/late buckets based on event start_time)
   - Extract recommendation features (genre match, performer popularity, venue vibe, price range, etc.)
4. Scores events across each modal slot using weighted feature algorithm
5. Returns top-ranked events per slot with `why_this_fits` explanations
6. Formats as RecommendationsOutput with structured event data

**State Management:**

- **Bookings**: Stored in `vip_booking_requests` + `vip_booking_events` (audit log)
- **Deposits**: Stored in `vip_deposits` + `vip_deposit_configs` (per-venue settings)
- **VIP Tables**: Stored in `vip_venue_tables` (metadata), `vip_table_availability` (per-date pricing), `vip_table_day_defaults` (day-of-week templates)
- **API Keys**: Stored in `mcp_api_keys` (source of truth) + `mcp_api_usage_daily` + `mcp_api_usage_minute` (quota tracking)
- **Unmet Requests**: Stored in `public.concierge_unmet_requests` (operations backlog)
- **Sessions**: In-memory Map (MCP HTTP sessions), cookie-based (dashboard sessions)

## Key Abstractions

**Tool Handler Pattern:**
- Purpose: Wrap service call with schema validation, timing, and error handling
- Examples: `src/tools/events.ts`, `src/tools/vipBookings.ts`, `src/tools/vipTables.ts`
- Pattern: Define input schema, output schema → `runTool(name, outputSchema, async () => service())` → handles validation, timing, logging in one place

**Service Pattern:**
- Purpose: Encapsulate business logic with testable, reusable interfaces
- Examples: `searchEvents()`, `createVipBookingRequest()`, `getVipTableAvailability()`
- Pattern: Typed input object → query builder → Supabase call → row transformer → typed output

**VIP Pricing Fallback Chain:**
- Purpose: Graceful degradation when pricing data is incomplete
- Pattern: Level 1 (exact date) → Level 2 (day-of-week) → Level 3 (venue default) → Level 4 (unknown, status="unknown")
- File: `src/services/vipTables.ts` (functions `resolvePricingForTable()`, `resolveVenueOpenDay()`)

**Chunked PostgREST Queries:**
- Purpose: Avoid 1000-row limit and URL length limit on `.in()` filters
- Pattern: Split large ID arrays into 100-ID batches, fetch in parallel, merge results
- File: `src/services/events.ts` (function `fetchOccurrencesByIds()`)
- Used for: Event occurrences by ID, event metadata, genre lookups

**Service Day Logic:**
- Purpose: Handle 6am JST service-day rollover for "tonight" and "this_weekend" dates
- Pattern: Compute current service date from timezone + cutoff time → map date filter to UTC range
- File: `src/utils/time.ts` (functions `getCurrentServiceDate()`, `parseDateFilter()`)
- Example: At 2am JST Saturday, "tonight" resolves to Friday night's service date

**Recommendation Modal Scoring:**
- Purpose: Rank events into recommendation slots (early/prime/late) with explanations
- Pattern: Extract event features (genre, performer, venue, price) → score each modal slot → rank by score → return top N
- File: `src/services/recommendations.ts`, `src/utils/recommendationFeatures.ts`
- Output includes `why_this_fits` array (2-3 human-readable reasons)

**Rate Limiting:**
- Purpose: Quota enforcement on API keys (daily + minute limits)
- Pattern: Extract key from header → query RPC `consume_mcp_api_request()` → get remaining quota → return in headers
- File: `src/auth/authorize.ts` (RPC call)
- Headers: `X-RateLimit-Daily-Limit`, `X-RateLimit-Daily-Remaining`, `X-RateLimit-Minute-Limit`, `X-RateLimit-Minute-Remaining`

**Admin Session Management:**
- Purpose: Authenticate dashboard users (username:password) without external provider
- Pattern: Parse VIP_DASHBOARD_ADMINS env var → hash password on login → create session cookie → require on dashboard routes
- File: `src/admin/dashboardAuth.ts` (class DashboardAuth)
- Session TTL configurable via `VIP_DASHBOARD_SESSION_TTL_MINUTES`

## Entry Points

**Stdio Entry Point (Local Claude Desktop):**
- Location: `src/index.ts`
- Triggers: `npm run dev` or via Claude Desktop configuration
- Responsibilities: Load config, create Supabase client, create MCP server, attach stdio transport, start

**HTTP Entry Point (Remote Clients):**
- Location: `src/http.ts`
- Triggers: `npm run dev:http` or in production
- Responsibilities: Load config, create Express app, setup middleware, register routes (/mcp, /api/v1, /ops, /stripe, /health), listen on port

**MCP Server Factory:**
- Location: `src/server.ts`
- Triggers: Called by both entry points
- Responsibilities: Create McpServer instance, register all tools, conditionally include ops tools based on API key tier

**REST Router Factory:**
- Location: `src/rest.ts`
- Triggers: Called in HTTP setup
- Responsibilities: Create Express router, mount GET endpoints for all API v1 routes

**Admin Router Factory:**
- Location: `src/admin/vipAdminRouter.ts`
- Triggers: Called in HTTP setup
- Responsibilities: Create Express router, mount POST/PATCH/GET endpoints for VIP bookings and table ops

## Error Handling

**Strategy:** Custom NightlifeError codes with HTTP status mapping

**Patterns:**

1. **Throw in Services**: Services throw `NightlifeError` with code + message
   ```typescript
   if (!cityContext) {
     throw new NightlifeError("UNSUPPORTED_CITY", `City not found: ${city}`);
   }
   ```

2. **Catch in Tools**: Tool handlers catch, check code, format as MCP error response
   ```typescript
   try {
     return await searchEvents(...);
   } catch (error) {
     return toolErrorResponse(toNightlifeError(error));
   }
   ```

3. **Catch in REST**: REST handlers catch, map to HTTP status via `errorToHttpStatus()`
   ```typescript
   try {
     return await searchEvents(...);
   } catch (error) {
     res.status(errorToHttpStatus(nle.code)).json({ error: { code, message } });
   }
   ```

4. **Error Codes**: Defined in `src/errors.ts`, includes INVALID_*, NOT_FOUND, DB_QUERY_FAILED, INTERNAL_ERROR, etc.

## Cross-Cutting Concerns

**Logging:**
- Approach: Event-based via `logEvent(eventName, payload)` to stderr
- Tools log: tool name, input params (sanitized), result count, error code if failed
- HTTP requests log: method, path, status, duration, API key ID/tier, session ID
- File: `src/observability/metrics.ts` (function `logEvent()`)

**Validation:**
- Approach: Zod schemas for all inputs (tool arguments, request query params) + all outputs
- Tool input schemas: Object with z.string().min(1), z.number().int(), z.enum(), etc.
- Service inputs: Typed TypeScript objects (implicit validation before call)
- Output validation: Zod schema.parse() in tool handler — ensures type safety
- File: `src/tools/schemas.ts`, per-tool definitions

**Authentication:**
- Approach: API key in `x-api-key` or `Authorization: Bearer` header → validate via DB RPC or env fallback
- DB path: Query `mcp_api_keys` for key match, check status=active, return tier + quotas
- Env path: Compare against `MCP_HTTP_API_KEYS` (simple list for non-DB scenarios)
- Timing-safe comparison to prevent timing attacks
- File: `src/auth/apiKeys.ts`, `src/auth/authorize.ts`

**Rate Limiting:**
- Approach: Per-key daily quota + minute quota via DB RPC
- RPC `consume_mcp_api_request()` decrements quota, returns remaining
- Headers returned to client for visibility
- File: `src/auth/authorize.ts` (RPC call)

**Request Context:**
- Approach: API key ID, tier, fingerprint attached to request object for logging/audit
- Used by: Admin router (audit trail), observability (metrics)
- File: `src/middleware/apiKeyAuth.ts` (RequestWithAuth type)

**Session Management:**
- Approach: In-memory Map<sessionId, SessionContext> for MCP HTTP + cookie-based for dashboard
- MCP: Creates new session per initialize request, stores server + transport, cleans up on session close
- Dashboard: Creates session on login, stores in cookie, validates on each request
- File: `src/http.ts` (session map), `src/admin/dashboardAuth.ts` (dashboard sessions)
