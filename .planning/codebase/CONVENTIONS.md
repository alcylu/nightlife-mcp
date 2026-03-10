# Coding Conventions

**Analysis Date:** 2026-03-10

## Naming Patterns

**Files:**
- Kebab-case for all source files: `apiKeys.ts`, `vipTables.ts`, `dashboardAuth.ts`
- Test files use `.test.ts` suffix: `vipTables.test.ts`, `dashboardAuth.test.ts`
- Feature/tool registration files named directly after capability: `events.ts`, `venues.ts`, `performers.ts`
- Service implementations live in `src/services/` with exported functions matching operation names

**Functions:**
- camelCase for all function names, both private and exported
- Functions prefixed with `__testOnly_` for test-scoped exports (e.g., `__testOnly_sortPerformerSummaries` in `src/services/performers.ts`)
- Tool registration functions follow pattern: `register[Feature]Tools` (e.g., `registerEventTools`, `registerVipBookingTools`)
- Query/fetch functions follow pattern: `[action][Entity]` (e.g., `searchEvents`, `getEventDetails`, `getPerformerInfo`)
- Helper functions use descriptive verb+noun: `normalizeCity`, `chunkArray`, `firstRelation`, `maybeJa`

**Variables:**
- camelCase for local and module-level variables
- SCREAMING_SNAKE_CASE for regex constants: `UUID_RE`, `ISO_DATE_RE`, `HH_MM_RE`, `VIP_HOURS_EVENT_PREFIX`
- Type-specific prefixes for regex: `HH_MM_RE`, `ISO_DATE_RE` (no generic `PATTERN_RE`)
- Private module state stored in Map/Set with simple names: `toolCounters`, `httpCounter`, `unmetRequestCounter`
- Query selection strings named descriptively: `OCCURRENCE_SELECT`, `VENUE_SELECT`

**Types:**
- PascalCase for all interfaces and type aliases: `CityContext`, `EventSummary`, `EventDetail`, `ToolDeps`
- Input/output type pairs: `SearchEventsInput`, `SearchEventsOutput` (or inlined in return types)
- Row types from DB queries: `[Entity]Row` (e.g., `EventOccurrenceRow`, `GenreRow`, `VenueAreaRow`)
- Counter types: `[Entity]Counter` (e.g., `ToolCounter`, `HttpCounter`, `UnmetRequestCounter`)
- Exported types use union discriminators: `NightlifeErrorCode`, `VipBookingStatus`, `VipTableStatus` (all string literals)

## Code Style

**Formatting:**
- No linter or formatter detected; follows Node.js/TypeScript conventions organically
- Semicolons required at end of statements
- Indentation: 2 spaces
- String literals: double quotes preferred (seen in console output, type field values, etc.)
- Line length: varies, no strict enforcement visible

**Linting:**
- TypeScript strict mode enabled (`tsconfig.json`: `"strict": true`)
- No external linter (eslint/biome/prettier) in package.json — relies on tsc type checking
- Type assertions used sparingly; mostly implicit types through inference
- Module resolution: NodeNext with strict null checks

## Import Organization

**Order:**
1. Node.js standard library imports (e.g., `import test from "node:test"`, `import { createHash } from "node:crypto"`)
2. Third-party packages (e.g., `@modelcontextprotocol/sdk`, `@supabase/supabase-js`, `zod`, `date-fns-tz`)
3. Local relative imports from `src/` using `.js` extension (e.g., `from "../errors.js"`, `from "./schemas.js"`)

**Path Aliases:**
- No path aliases (`paths` in tsconfig) — all imports use relative paths or full package names
- All local imports end with `.js` extension (ESM compliance): `from "../config.js"`, `from "./metrics.js"`
- Relative traversal with `../` for cross-directory imports

**Type imports:**
- Explicit `type` keyword for type-only imports: `import type { SupabaseClient } from "@supabase/supabase-js"`
- Shared types grouped in single `types.ts` file and imported into services/tools: `import type { EventSummary } from "../types.js"`

## Error Handling

**Patterns:**
- Custom `NightlifeError` class in `src/errors.ts` with typed error codes
- All user-facing errors thrown as `NightlifeError` with `code` and optional `details`
- Constructor: `new NightlifeError(code: NightlifeErrorCode, message: string, details?: Record<string, unknown>)`
- Conversion helper: `toNightlifeError(error, fallbackCode)` wraps unknown errors
- HTTP status mapping via `errorToHttpStatus(code: NightlifeErrorCode): number` (400 for validation, 404 for not found, 500 for internal)
- Tool responses use `toolErrorResponse(error: NightlifeError)` to format `{ error: { code, message } }`
- Errors logged via `logEvent()` to stderr with tool name and context

**Example:**
```typescript
if (!cityCtx) {
  throw new NightlifeError("INVALID_REQUEST", `City not found: ${slug}`);
}

// In REST handler:
try {
  const result = await searchEvents(supabase, config, { ... });
} catch (error) {
  const nle = toNightlifeError(error);
  res.status(errorToHttpStatus(nle.code)).json({
    error: { code: nle.code, message: nle.message }
  });
}
```

## Logging

**Framework:** `console.error()` for all structured logging

**Patterns:**
- Single `logEvent(event: string, fields: Record<string, unknown>)` function in `src/observability/metrics.ts`
- Format: `[nightlife-mcp] {event} {JSON.stringify(fields)}`
- Called from tool handlers to log execution, errors, and metrics
- Example: `logEvent("search_events", { city, genre, result_count, error_code })`
- No debug logs; events logged at stderr level only
- Health endpoint returns metrics snapshot without DB logging

## Comments

**When to Comment:**
- Inline comments used sparingly — mostly for regex intent or non-obvious logic
- Comments document "why" only when reason is non-obvious from code (e.g., workaround for known issue)
- SQL/PostgREST queries documented with single-line explanation above SELECT string

**JSDoc/TSDoc:**
- Not used. Functions are self-documenting via type signatures
- Input/output types fully spelled out; no need for `@param` / `@returns` comments
- Tool descriptions embedded in tool registration (e.g., `createVipBookingToolDescription` in `src/tools/vipBookings.ts`)

**Example:** No JSDoc in codebase. Tool intent documented in:
```typescript
// Service function signature is fully typed:
export async function searchEvents(
  supabase: SupabaseClient,
  config: AppConfig,
  input: SearchEventsInput,
): Promise<SearchEventsOutput> { ... }

// Tool registration includes human-readable description:
server.tool("search_events", { ... }, async (input) => {
  const start = Date.now();
  try {
    return await searchEvents(supabase, config, input);
  } catch (error) {
    recordToolResult({ tool: "search_events", durationMs: Date.now() - start, errorCode: nle.code });
  }
});
```

## Function Design

**Size:**
- Average 20–40 lines per function
- Utility functions (normalizers, parsers) typically 5–15 lines
- Query/fetch functions with error handling 30–50 lines
- No functions exceed 100 lines; complex logic broken into private helpers

**Parameters:**
- Explicit parameter objects for multi-arg functions: `input: SearchEventsInput` (not scattered params)
- Dependencies injected as first args: `supabase: SupabaseClient`, `config: AppConfig`, then `input: InputType`
- DB queries take `supabase` first, then `config`, then domain-specific params
- Optional params use `?` in interface (never overloaded functions)

**Return Values:**
- Explicit return type always specified (no implicit `any`)
- Promise-based returns for async I/O: `Promise<SearchEventsOutput>`
- Typed output objects: `{ city, date_filter, events, unavailable_city }`
- Null returns used for "not found" cases (e.g., `getCityContext` returns `CityContext | null`)
- Never return bare arrays/objects; wrap in output interface

**Example:**
```typescript
export async function searchEvents(
  supabase: SupabaseClient,
  config: AppConfig,
  input: SearchEventsInput,
): Promise<SearchEventsOutput> {
  // validate
  // query
  // transform
  // return typed output
}
```

## Module Design

**Exports:**
- Modules export only public functions, types, and constants
- Service modules export async query/fetch functions
- Tools modules export registration function + schemas
- Utilities export pure functions for transformation/parsing
- All public exports are `export`, not `export default`

**Barrel Files:**
- No barrel files (`index.ts`) in feature directories — each file exports directly
- `src/tools/schemas.ts` acts as shared schema collection (imported by multiple tools)
- `src/types.ts` is central type export — imported by services, tools, and routes

**Module structure example:**
```
src/services/events.ts
├── Type definitions (SearchEventsInput, SearchEventsOutput)
├── Private helpers (normalizeCity, chunkArray)
├── Query constants (OCCURRENCE_SELECT)
├── Public async functions (searchEvents, getEventDetails)
└── Internal error handling

src/tools/events.ts
├── Type definitions (ToolDeps)
├── Import schemas from tools/schemas.ts
├── Define Zod schemas inline (eventSummarySchema, etc.)
├── Register all event tools to server
└── Tool implementation with metrics recording
```

---

*Convention analysis: 2026-03-10*
