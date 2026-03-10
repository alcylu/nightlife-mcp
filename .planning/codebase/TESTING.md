# Testing Patterns

**Analysis Date:** 2026-03-10

## Test Framework

**Runner:**
- Node.js built-in `node:test` module
- No external test runner (Jest, Vitest, Mocha) — native Node.js testing only
- Config: no test config file needed (built-in, uses file globbing)

**Assertion Library:**
- `node:assert/strict` for all assertions
- Import: `import assert from "node:assert/strict"`
- No other assertion libraries (no chai, expect, or custom helpers)

**Run Commands:**
```bash
npm run test              # Run all tests matching src/**/*.test.ts
npm run check            # Type check only (tsc --noEmit)
```

## Test File Organization

**Location:**
- Co-located with source: tests live alongside implementation in same directory
- Pattern: `{feature}.ts` paired with `{feature}.test.ts`

**Naming:**
- Suffix: `.test.ts` (always, never `.spec.ts`)
- Examples: `vipTables.test.ts`, `dashboardAuth.test.ts`, `requests.test.ts`

**File count:** 13 test files in codebase
- `src/tools/vipTables.test.ts` — schema validation + error response tests
- `src/tools/vipBookings.test.ts` — VIP booking output schemas + tool description validation
- `src/tools/vipTableOps.test.ts` — ops-only mutation schemas + error handling
- `src/services/requests.test.ts` — unmet request write behavior + payload normalization
- `src/services/performers.test.ts` — UUID validation + sorting behavior
- `src/admin/dashboardAuth.test.ts` — auth flow + session validation
- `src/utils/recommendationFeatures.test.ts` — feature derivation determinism + scoring

## Test Structure

**Suite Organization:**
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { functionUnderTest } from "./module.js";

test("descriptive test name", () => {
  // arrange
  const input = { ... };

  // act
  const result = functionUnderTest(input);

  // assert
  assert.equal(result.field, expectedValue);
});

test("descriptive test name for error case", async () => {
  // for async functions using rejects
  await assert.rejects(
    async () => functionUnderTest(badInput),
    (error) => error instanceof NightlifeError && error.code === "EXPECTED_CODE"
  );
});
```

**Patterns:**

1. **Schema Validation Tests** — validate Zod schema acceptance:
```typescript
test("vipTableAvailabilityOutputSchema accepts daily availability payload", () => {
  const parsed = vipTableAvailabilityOutputSchema.parse({
    venue_id: "...",
    venue_name: "...",
    // ... full payload
  });

  assert.equal(parsed.days.length, 1);
  assert.equal(parsed.days[0].tables[0].status, "available");
});
```

2. **Error Handling Tests** — validate rejection + error code:
```typescript
test("logUnmetRequest validates raw_query", async () => {
  await assert.rejects(
    async () => logUnmetRequest({} as any, { raw_query: "   " }),
    (error) => error instanceof NightlifeError && error.code === "INVALID_REQUEST",
  );
});
```

3. **Side-Effect Tests** — verify object mutation or state change:
```typescript
test("logUnmetRequest writes normalized payload", async () => {
  let inserted: Record<string, unknown> | null = null;
  const supabase = {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        inserted = payload;
        return { select: () => ({ single: async () => ({ data, error }) }) };
      },
    }),
  } as any;

  const result = await logUnmetRequest(supabase, { ... });

  assert.equal(result.request_id, "...");
  assert.equal((inserted as any).channel, "discord");  // normalized to lowercase
});
```

4. **Deterministic Algorithm Tests** — verify scoring/sorting:
```typescript
test("feature derivation is stable for a high-energy party profile", () => {
  const genres = ["Techno", "EDM"];
  const name = "Warehouse Techno Party";

  assert.equal(deriveEnergyScore(genres, name, 9), 5);
  assert.equal(deriveSocialScore(genres, name, 9), 5);
});
```

5. **Middleware/Auth Tests** — validate request/response transformation:
```typescript
test("requireApiSession allows valid session and sets dashboard user", () => {
  const auth = createDashboardAuth({ ... });
  const sessionId = auth.createSession("ops");
  const req = { headers: { cookie: `vip_dashboard_session=${sessionId}` } } as any;
  const res = createMockRes();

  let calledNext = false;
  auth.requireApiSession(req, res as any, () => { calledNext = true; });

  assert.equal(calledNext, true);
  assert.equal(req.dashboardAdminUsername, "ops");
});
```

## Mocking

**Framework:** Manual mocking — no mock library (Jest, Sinon, etc.)

**Patterns:**

1. **Partial Type Mocking** — mock Supabase client with minimal implementation:
```typescript
const supabase = {
  from: () => ({
    insert: (payload: Record<string, unknown>) => {
      inserted = payload;
      return {
        select: () => ({
          single: async () => ({ data, error }),
        }),
      };
    },
  }),
} as any;
```

2. **Response Mock Objects** — hand-written response objects for Express:
```typescript
type MockRes = {
  headers: Record<string, string>;
  statusCode: number;
  payload: unknown;
  redirectLocation: string | null;
  setHeader: (name: string, value: string) => void;
  status: (code: number) => MockRes;
  json: (payload: unknown) => void;
  redirect: (path: string) => void;
};

function createMockRes(): MockRes {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    redirectLocation: null,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.payload = payload; },
    redirect(path: string) { this.redirectLocation = path; },
  };
}
```

**What to Mock:**
- Supabase client (always) — capture calls, return fixed responses
- Express Response (always) — capture headers, status, payload
- Config object (as needed) — inject test values for timezone, URLs, keys
- Never mock: Core functions under test, built-in Node.js APIs, pure logic

**What NOT to Mock:**
- Zod schema parsing — test actual validation behavior
- Error classes (`NightlifeError`) — verify actual error handling
- Helper functions (normalizers, parsers) — test with real inputs
- Time-based logic — use fixed dates in test, not mocked Date

## Fixtures and Factories

**Test Data:**
- Fixtures hardcoded inline in tests (no separate fixture files)
- Full payload objects asserted directly:
```typescript
const parsed = vipTableAvailabilityOutputSchema.parse({
  venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
  venue_name: "Zouk",
  booking_date_from: "2026-03-01",
  // ... full object
});
```
- Config objects created in tests:
```typescript
const config = {
  supabaseUrl: "https://example.com",
  supabaseServiceRoleKey: "x",
  serverName: "nightlife-mcp",
  // ... all required fields
};
```

**Location:**
- No centralized fixtures directory
- Test data created locally in each test function
- Shared mock factories defined at top of test file (e.g., `createMockRes()`)

## Coverage

**Requirements:** Not enforced — no coverage threshold or reporting configured

**View Coverage:**
- Not applicable (no coverage tools configured)
- Manual test review needed to assess gaps

## Test Types

**Unit Tests:**
- Scope: Single function behavior (schema validation, error handling, normalization)
- Approach: Test input→output with mock dependencies
- Examples: `searchEvents` validation, `logUnmetRequest` normalization
- No external I/O except mocked Supabase

**Integration Tests:**
- Not explicitly separated from unit tests
- Some tests verify full flow (e.g., dashboard auth session creation + retrieval)
- Still use mocks for external I/O, but test multiple functions together

**E2E Tests:**
- Not used in this codebase
- Live testing done via browser (documented in project CLAUDE.md)
- Smoke tests for production auth exist in `scripts/prod-auth-smoke.mjs` (Node.js script, not in test framework)

## Common Patterns

**Async Testing:**
```typescript
test("async function throws on invalid input", async () => {
  await assert.rejects(
    async () => asyncFunction(badInput),
    (error) => error instanceof NightlifeError && error.code === "EXPECTED",
  );
});

test("async function returns expected result", async () => {
  const result = await asyncFunction(validInput);
  assert.equal(result.field, expectedValue);
});
```

**Error Testing:**
```typescript
// Test NightlifeError with code matching:
await assert.rejects(
  async () => functionThatThrows(),
  (error) => {
    return error instanceof NightlifeError &&
           error.code === "SPECIFIC_CODE" &&
           error.message.includes("relevant text");
  },
);

// Test toolErrorResponse formatting:
const payload = toolErrorResponse(
  new NightlifeError("BOOKING_NOT_FOUND", "VIP booking request not found.")
);
assert.deepEqual(payload, {
  error: {
    code: "BOOKING_NOT_FOUND",
    message: "VIP booking request not found.",
  },
});
```

**Schema Validation:**
```typescript
// Positive case — verify schema accepts valid payload:
const parsed = outputSchema.parse(validPayload);
assert.equal(parsed.field, expectedValue);

// Negative case — implicit (schema parse would throw if invalid):
// No explicit test for schema rejection; Zod errors caught elsewhere
```

**Test-Only Exports:**
- Internal test-facing functions prefixed `__testOnly_`:
```typescript
// In performers.ts:
export function __testOnly_sortPerformerSummaries(
  items: PerformerSummary[],
  sortBy: "ranking" | "recent_activity",
): PerformerSummary[] { ... }

// In test:
import { __testOnly_sortPerformerSummaries } from "./performers.js";
test("performer sorting supports recent_activity mode", () => {
  const sorted = __testOnly_sortPerformerSummaries([...], "recent_activity");
  assert.deepEqual(sorted.map(item => item.performer_id), ["p2", "p1", "p3"]);
});
```

---

*Testing analysis: 2026-03-10*
