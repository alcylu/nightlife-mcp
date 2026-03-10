# Codebase Structure

**Analysis Date:** 2025-03-10

## Directory Layout

```
nightlife-mcp/
├── src/                          # All TypeScript source code (ES modules)
│   ├── index.ts                  # Stdio entry point (Claude Desktop)
│   ├── http.ts                   # HTTP entry point (remote clients, ~1000 lines)
│   ├── server.ts                 # MCP server factory + tool registration
│   ├── config.ts                 # Environment variable validation (Zod)
│   ├── types.ts                  # Shared response types (550+ lines)
│   ├── errors.ts                 # NightlifeError class + HTTP status mapping
│   ├── rest.ts                   # REST API v1 router (/api/v1/*)
│   ├── openapi.ts                # OpenAPI 3.1 spec definition
│   │
│   ├── auth/                     # API key authentication
│   │   ├── apiKeys.ts            # Key extraction from headers, hashing, comparison
│   │   └── authorize.ts          # DB RPC validation, quota tracking
│   │
│   ├── middleware/               # Express middleware
│   │   └── apiKeyAuth.ts         # Shared API key auth (REST + MCP), sets rate limit headers
│   │
│   ├── db/                       # Database client
│   │   └── supabase.ts           # Supabase client factory
│   │
│   ├── services/                 # Business logic, reused by tools + REST
│   │   ├── events.ts             # searchEvents(), getEventDetails() (~30KB, chunked genre fetch)
│   │   ├── venues.ts             # searchVenues(), getVenueInfo()
│   │   ├── performers.ts         # searchPerformers(), getPerformerInfo()
│   │   ├── recommendations.ts    # getRecommendations() (scoring algorithm)
│   │   ├── vipBookings.ts        # create/get VIP booking requests (~50KB, deposit logic)
│   │   ├── vipTables.ts          # VIP table availability + 4-level pricing fallback (~40KB)
│   │   ├── vipAdmin.ts           # Admin CRUD for bookings + table ops (~23KB)
│   │   ├── deposits.ts           # Deposit creation, Stripe integration (~20KB)
│   │   ├── guestList.ts          # Guest list sign-ups + request log
│   │   ├── requests.ts           # Unmet request logging for concierge
│   │   ├── cities.ts             # City context lookup, listCities()
│   │   ├── helpers.ts            # listGenres(), listAreas()
│   │   ├── email.ts              # Email template builder (Resend)
│   │   ├── stripe.ts             # Stripe helper (webhook signature verification)
│   │   ├── vipBookings.test.ts   # VIP booking tests
│   │   ├── vipTables.test.ts     # VIP table tests
│   │   ├── vipAdmin.test.ts      # VIP admin tests
│   │   ├── performers.test.ts    # Performer search tests
│   │   ├── requests.test.ts      # Unmet request logging tests
│   │   ├── venues.test.ts        # Venue search tests
│   │   └── recommendations.test.ts # Recommendation algorithm tests
│   │
│   ├── tools/                    # MCP tool definitions + handlers
│   │   ├── events.ts             # Tool: search_events, get_event_details, get_recommendations
│   │   ├── venues.ts             # Tool: search_venues, get_venue_info
│   │   ├── performers.ts         # Tool: search_performers, get_performer_info
│   │   ├── requests.ts           # Tool: log_unmet_request
│   │   ├── vipBookings.ts        # Tool: create_vip_booking_request, get_vip_booking_status, cancel_vip_booking_request
│   │   ├── vipTables.ts          # Tool: get_vip_table_availability, get_vip_table_chart
│   │   ├── vipAgentOps.ts        # Tool: get_vip_agent_task, claim_vip_agent_task, etc. (ops-only)
│   │   ├── vipTableOps.ts        # Tool: set_vip_table_availability, etc. (ops-only)
│   │   ├── deposits.ts           # Tool: get_vip_deposit_status, refund_vip_deposit (ops-only)
│   │   ├── guestList.ts          # Tool: sign_up_guest_list, get_guest_list_status
│   │   ├── helpers.ts            # Tool: list_cities, list_genres, list_areas
│   │   ├── schemas.ts            # Shared Zod schemas (input/output validation)
│   │   ├── vipTables.test.ts     # VIP table tool tests
│   │   ├── vipBookings.test.ts   # VIP booking tool tests
│   │   └── vipAgentOps.test.ts   # VIP agent ops tool tests
│   │
│   ├── admin/                    # VIP dashboard (authenticated)
│   │   ├── vipAdminRouter.ts     # POST/PATCH/GET routes for admin VIP operations
│   │   ├── dashboardAuth.ts      # Session management, username:password validation
│   │   ├── vipDashboardPage.ts   # HTML rendering for dashboard + login page
│   │   └── dashboardAuth.test.ts # Dashboard auth tests
│   │
│   ├── routes/                   # Additional routers
│   │   └── stripeWebhook.ts      # POST /stripe/webhook (Stripe event handling)
│   │
│   ├── pages/                    # HTML page renders
│   │   └── depositResult.ts      # Deposit success/cancelled pages (post-checkout)
│   │
│   ├── constants/                # Shared constants
│   │   └── modals.ts             # Recommendation modal definitions
│   │
│   ├── emails/                   # Email templates
│   │   └── templates.ts          # Resend email template builders
│   │
│   ├── observability/            # Metrics and logging
│   │   └── metrics.ts            # Tool counters, HTTP stats, event logging, runtime snapshot
│   │
│   ├── utils/                    # Utility functions
│   │   ├── time.ts               # Service-day logic, date parsing, timezone conversion (~220 lines)
│   │   ├── recommendationFeatures.ts  # Feature extraction for recommendations (~350 lines)
│   │   └── recommendationFeatures.test.ts
│   │
│   └── scripts/                  # One-off CLI scripts
│       └── createApiKey.ts       # Create API key in DB (requires auth)
│
├── supabase/                     # Database migrations
│   ├── migrations/
│   │   ├── 20260219094000_mcp_api_keys.sql         # API key table + RPC
│   │   ├── 20260220_user_api_keys.sql              # RLS + self-service keys
│   │   └── 20260226_concierge_unmet_requests.sql   # Unmet request backlog
│   └── .temp/                    # Temp directory (git-ignored)
│
├── docs/                         # Documentation
│   └── apaleo-pitch.md           # Pitch for Apaleo Agent Hub listing
│
├── .planning/
│   └── codebase/                 # (This directory, generated by GSD mapper)
│       ├── ARCHITECTURE.md       # Architecture patterns and layers
│       ├── STRUCTURE.md          # This file
│       ├── STACK.md              # (Generated by GSD)
│       ├── INTEGRATIONS.md       # (Generated by GSD)
│       ├── CONVENTIONS.md        # (Generated by GSD)
│       ├── TESTING.md            # (Generated by GSD)
│       └── CONCERNS.md           # (Generated by GSD)
│
├── dist/                         # Compiled JavaScript (git-ignored, generated by tsc)
├── node_modules/                 # Dependencies (git-ignored)
│
├── .git/                         # Git repository
├── .gitignore                    # Standard node .gitignore
├── package.json                  # Dependencies, scripts, metadata
├── tsconfig.json                 # TypeScript compiler options
├── CLAUDE.md                     # (Project-specific instructions)
└── README.md                     # (Project readme)
```

## Directory Purposes

**src/**
- Purpose: All TypeScript source code (ES modules, emitted to dist/)
- Contains: Entry points, business logic, tools, utilities
- Key files: index.ts (stdio), http.ts (HTTP), server.ts (MCP setup)

**src/auth/**
- Purpose: API key authentication and authorization
- Contains: Key extraction/parsing, hash comparison, DB RPC calls for quota validation
- Key files: apiKeys.ts (extraction), authorize.ts (validation + RPC)

**src/middleware/**
- Purpose: Express middleware for cross-cutting concerns
- Contains: API key authentication (shared by /mcp and /api/v1 routes)
- Key files: apiKeyAuth.ts (createApiKeyAuthMiddleware)

**src/db/**
- Purpose: Database connection and client
- Contains: Single Supabase client factory
- Key files: supabase.ts

**src/services/**
- Purpose: Business logic, reusable by both tools and REST endpoints
- Contains: Query builders, data transformation, validation logic
- Key files: events.ts (~30KB, chunked genre fetch), vipBookings.ts (~50KB), vipTables.ts (~40KB)
- Pattern: Each service exports typed functions taking (supabase, config, input) → Promise<output>

**src/tools/**
- Purpose: MCP tool definitions and handlers
- Contains: Tool registration, Zod schema validation, service orchestration
- Key files: events.ts, vipBookings.ts, vipTables.ts (largest tool files)
- Pattern: registerXxxTools(server, deps) called by server factory

**src/admin/**
- Purpose: VIP booking dashboard (authenticated)
- Contains: Admin routes (CRUD for bookings), session management, HTML rendering
- Key files: vipAdminRouter.ts (API routes), dashboardAuth.ts (session), vipDashboardPage.ts (HTML)

**src/routes/**
- Purpose: Additional Express routers (not core event/venue/performer)
- Contains: Stripe webhook handler (payment events)
- Key files: stripeWebhook.ts

**src/pages/**
- Purpose: HTML page rendering
- Contains: Deposit success/cancelled pages (post-checkout redirect)
- Key files: depositResult.ts

**src/constants/**
- Purpose: Shared constant definitions
- Contains: Recommendation modal metadata
- Key files: modals.ts

**src/emails/**
- Purpose: Email template builders
- Contains: HTML/text email templates for Resend
- Key files: templates.ts

**src/observability/**
- Purpose: Metrics, logging, and runtime telemetry
- Contains: Tool call counters, HTTP stats, event log, runtime metrics snapshot
- Key files: metrics.ts (logEvent, recordToolResult, recordHttpRequest, snapshotRuntimeMetrics)

**src/utils/**
- Purpose: Utility functions (cross-cutting, no business logic)
- Contains: Service-day time logic, date parsing, timezone conversion, recommendation feature extraction
- Key files: time.ts (~220 lines), recommendationFeatures.ts (~350 lines)

**src/scripts/**
- Purpose: One-off CLI scripts
- Contains: API key creation helper (requires auth)
- Key files: createApiKey.ts

**supabase/migrations/**
- Purpose: Database schema and RPC definitions
- Contains: API key tables, self-service key RLS, concierge unmet request table
- Key files: 20260219094000_mcp_api_keys.sql, 20260220_user_api_keys.sql, 20260226_concierge_unmet_requests.sql

## Key File Locations

**Entry Points:**
- `src/index.ts`: Stdio (local Claude Desktop), loads config → creates Supabase client → creates MCP server → connects stdio transport
- `src/http.ts`: HTTP (remote clients, production), loads config → creates Express app → registers middleware/routes → listens on port

**Configuration:**
- `src/config.ts`: Zod schema parsing all env vars, returns typed AppConfig object
- `package.json`: Dependencies (MCP SDK, Supabase, Express, Stripe, Resend)
- `tsconfig.json`: ES2022 target, strict mode, NodeNext module resolution

**Core Logic:**
- `src/services/events.ts`: Event search (chunked genre fetch to avoid PostgREST limits), detail lookup
- `src/services/vipBookings.ts`: Create booking requests, status lookup, cancellation, deposit logic
- `src/services/vipTables.ts`: Table availability for date range, 4-level pricing fallback, chart data
- `src/services/recommendations.ts`: Modal-based recommendation algorithm with feature scoring
- `src/utils/time.ts`: Service-day rollover logic (6am JST cutoff), date filter parsing

**Testing:**
- `src/**/*.test.ts`: Service and tool tests using Node.js test runner (tsx --test)
- Key test files: vipBookings.test.ts, vipTables.test.ts, recommendations.test.ts

**Admin Dashboard:**
- `src/admin/vipAdminRouter.ts`: POST/PATCH/GET endpoints for bookings, tables, deposits
- `src/admin/dashboardAuth.ts`: Session management (cookie-based, TTL configurable)
- `src/admin/vipDashboardPage.ts`: Interactive HTML dashboard + login page

## Naming Conventions

**Files:**
- `camelCase.ts` for all files
- `service.ts` for business logic (events.ts, venues.ts, vipBookings.ts)
- `router.ts` for Express routers (vipAdminRouter.ts, stripeWebhookRouter returned)
- `index.ts` for entry points
- `config.ts`, `types.ts`, `errors.ts` for global utilities
- `*.test.ts` for tests (co-located with source)

**Directories:**
- `lowercase` for all directories (src, services, tools, admin, auth, etc.)
- One domain per directory (services/events.ts, services/venues.ts, not mixed)
- Logical grouping (admin/, routes/, pages/, observability/)

**Functions:**
- `camelCase()` for all functions
- Verb prefixes: `search*()`, `get*()`, `create*()`, `list*()`, `register*()`, `log*()`
- Service functions: `searchEvents(supabase, config, input) → Promise<output>`
- Tool functions: `registerEventTools(server, deps) → void`

**Constants:**
- `UPPER_SNAKE_CASE` for truly global constants (if used)
- `camelCase` for most constants (UUID_RE regex, OCCURRENCE_SELECT Supabase query string)
- Zod schemas: PascalCase schemas (`eventSummarySchema`) mixed with camelCase field names

**Types:**
- `PascalCase` for all interfaces/types (EventSummary, VipBookingStatus, etc.)
- Exported from `src/types.ts` (unified location)
- Local types in files (Row types, Input types) are in UPPER_CASE or descriptive names

## Where to Add New Code

**New Tool (Search/Discovery):**
1. Create `src/services/yourDomain.ts` with business logic functions
   - Export typed functions: `export async function searchYourDomain(supabase, config, input)`
2. Create `src/tools/yourDomain.ts` with tool registration
   - Call `server.setRequestHandler(Tool, ...)` for each tool
   - Use Zod schemas for input/output validation
   - Wrap service calls with `runTool()` for timing + error handling
3. Register in `src/server.ts`: import and call `registerYourDomainTools(server, deps)`
4. Add tests: `src/services/yourDomain.test.ts` and `src/tools/yourDomain.test.ts`
5. Add to `src/rest.ts` if REST endpoint needed (usually is)

**New Admin Operation:**
1. Add service function to `src/services/vipAdmin.ts` or domain-specific service
2. Add route to `src/admin/vipAdminRouter.ts`
3. Wrap with dashboard auth middleware: `(req, res, next) => dashboardAuth.requireApiSession(req, res, next)`
4. Add audit trail logging via service parameter
5. Add tests to `src/admin/*.test.ts`

**New Utility:**
- If **time-related**: add to `src/utils/time.ts`
- If **recommendation-related**: add to `src/utils/recommendationFeatures.ts`
- If **general helper**: create new file in `src/utils/yourHelper.ts`
- All utilities should be pure functions with no side effects

**New Integration (Stripe, Resend, etc.):**
1. Create `src/services/integration.ts` with business logic
2. Use existing patterns: typed input/output, error handling via NightlifeError
3. Call from appropriate service (e.g., `deposits.ts` calls Stripe)
4. Test with mock/stub (avoid real API calls in tests)

**New Route (non-admin):**
1. Create `src/routes/yourRoute.ts` with Express router factory
2. Export function: `export function createYourRouter(deps): Router`
3. Register in `src/http.ts`: `app.use("/prefix", createYourRouter(deps))`
4. Follow existing patterns: query parameter validation, error handling, observability

## Special Directories

**dist/**
- Purpose: Compiled JavaScript output
- Generated: Yes (by `npm run build` / `tsc`)
- Committed: No (git-ignored)
- Contains: Tree-shaken ES modules with .js extensions for Node.js

**node_modules/**
- Purpose: npm dependencies
- Generated: Yes (by `npm install`)
- Committed: No (git-ignored)
- Contains: MCP SDK, Supabase, Express, Stripe, Resend, TypeScript, etc.

**.planning/codebase/**
- Purpose: Generated documentation for GSD orchestration
- Generated: Yes (by `/gsd:map-codebase` command)
- Committed: Yes (reference documents for future tasks)
- Contains: ARCHITECTURE.md, STRUCTURE.md, STACK.md, INTEGRATIONS.md, CONVENTIONS.md, TESTING.md, CONCERNS.md

**supabase/migrations/**
- Purpose: Database schema version control
- Generated: No (manually written)
- Committed: Yes (required for reproducible schema)
- Contains: SQL files with timestamps, applied in order during `supabase db push`

**scripts/ (root level)**
- Purpose: Non-source scripts (e.g., Playwright tests, smoke tests)
- Generated: No
- Committed: Yes
- Example: `scripts/prod-auth-smoke.mjs` (smoke test for production auth)

## Build Output

**Build Command:** `npm run build` → runs `tsc -p tsconfig.json`

**Input:** All `src/**/*.ts` files (includes tests)

**Output:** `dist/` directory with same structure
- `dist/index.js` - Stdio entry point
- `dist/http.js` - HTTP entry point
- `dist/server.js` - Server factory
- `dist/services/` - All service modules
- `dist/tools/` - All tool modules
- `dist/admin/` - Admin module
- etc.

**Start Commands:**
- `npm start` → `node dist/index.js` (stdio)
- `npm start:http` → `node dist/http.js` (HTTP)

**Note:** Tests are also compiled to dist/ (*.test.js) but not executed during build. Run via `npm test`.
