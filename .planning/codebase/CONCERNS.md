# Codebase Concerns

**Analysis Date:** 2026-03-10

## Tech Debt

### Type Safety: Widespread `as any` Casting

**Issue:** Pervasive use of `as any` type assertions in test files and data transformation code, particularly in service layers.

**Files:**
- `src/services/performers.ts` (multiple `as unknown as GenreRow[]`, `as unknown as PerformerMediaRow[]` casts)
- `src/services/guestList.ts` (unsafe cast `(dayDirect as any).event_occurrences?.events?.name_en`)
- `src/services/vipTables.test.ts` (40+ mock object casts)
- `src/services/vipBookings.test.ts` (60+ test mock casts)
- `src/admin/dashboardAuth.ts` (line 123: `req.headers.cookie as unknown`)

**Impact:**
- Silent type errors that could surface at runtime
- Difficult to refactor: breaking changes invisible to type checker
- Test mocks bypass type verification entirely

**Fix Approach:**
1. Create proper TypeScript interfaces for all Supabase row types (move inline types to dedicated `types/rows.ts`)
2. Replace test `{} as any` casts with typed test factories using Zod
3. Add `strict: true` to tsconfig.json if not already enabled
4. Use `const _ = x satisfies ExpectedType` pattern to verify types without assertions
5. Create helper functions that perform runtime validation for unsafe casts

### Large Service Files

**Issue:** Multiple service files exceed 1000 lines, reducing readability and maintainability.

**Files:**
- `src/services/vipBookings.ts` (1685 lines) — VIP booking lifecycle operations
- `src/services/vipTables.ts` (1403 lines) — VIP table availability and pricing
- `src/services/performers.ts` (1128 lines) — Performer search and detail
- `src/services/venues.ts` (1123 lines) — Venue search and detail
- `src/services/events.ts` (1091 lines) — Event search and detail

**Impact:**
- Difficult to navigate and understand
- Higher risk of bugs in complex logic
- Harder to test individual concerns
- Cognitive load on code review

**Fix Approach:**
1. Break `vipBookings.ts` into:
   - `vipBookings/create.ts` — booking request creation logic
   - `vipBookings/status.ts` — status transitions and updates
   - `vipBookings/alerts.ts` — alert and task management
   - `vipBookings/reservations.ts` — reservation listing and filtering
2. Split `vipTables.ts` into:
   - `vipTables/availability.ts` — availability queries
   - `vipTables/pricing.ts` — pricing fallback chain
   - `vipTables/charts.ts` — chart image uploads
   - `vipTables/crud.ts` — table CRUD operations
3. Similar refactoring for performers, venues, events — separate search from detail logic

### HTML Template Generation via String Concatenation

**Issue:** VIP dashboard page uses string concatenation to build large HTML templates with inline JavaScript.

**Files:**
- `src/admin/vipDashboardPage.ts` (1477 lines) — Single 1400+ line function returning HTML string

**Impact:**
- Single function responsible for HTML structure, styles, and complex client-side logic
- Difficult to maintain JavaScript embedded in HTML templates
- No tooling support for syntax highlighting or linting embedded code
- Risk of template syntax errors

**Fix Approach:**
1. Migrate to template file (e.g., Handlebars, EJS) or separate HTML file
2. Extract client-side JavaScript to separate `admin/vipDashboard.js` file with proper module structure
3. Move CSS to dedicated stylesheet in `src/styles/vipDashboard.css`
4. Use a build step to embed template if necessary

### Insufficient Input Validation on Optional Fields

**Issue:** Many service functions accept optional parameters but don't validate their content when provided, relying on null-coalescing defaults.

**Example:** `src/services/vipBookings.ts` — `preferred_table_code` validated only via regex but not checked against actual table existence before use.

**Files:**
- `src/services/vipBookings.ts` (line 349+) — `normalizeSpecialRequests()` just slices at 500 chars without content validation
- `src/services/vipTables.ts` — Optional `note` fields never validated for SQL injection or excessive length
- `src/tools/schemas.ts` — Zod schemas accept many string fields without length constraints

**Impact:**
- Data quality issues (garbage input stored in DB)
- Potential for data corruption or unexpected behavior downstream
- Inconsistent error messages when validation is missing

**Fix Approach:**
1. Add length limits to all string fields in Zod schemas
2. Create normalization functions for all optional fields (not just required ones)
3. Add unit tests for edge cases: empty strings, very long strings, special characters
4. Use `refine()` on Zod schemas for complex cross-field validation

## Known Bugs

### In-Memory Session Store Leak (Dashboard Auth)

**Issue:** Dashboard authentication uses in-memory session map with only time-based pruning. Expired sessions aren't guaranteed to be cleaned up, and server restarts lose all sessions without warning.

**Symptoms:**
- Memory usage grows with each login (unbounded if pruning doesn't run)
- Users logged into dashboard get forcibly logged out on server restart
- No persistent session storage

**Files:** `src/admin/dashboardAuth.ts` (lines 85-94)

**Trigger:**
1. Login to VIP dashboard multiple times
2. Over time, session map grows
3. Only pruned on `resolveSession()` calls; inactive users' sessions leak
4. Server restart loses all sessions

**Workaround:** Periodically clear session map manually or restart server; dashboard users must re-login

**Fix Approach:**
1. Move sessions to Supabase `vip_dashboard_sessions` table with automatic TTL delete
2. Use RLS to ensure admins can only see their own sessions
3. Add background job to clean up expired sessions (or use Supabase TTL feature)
4. Add session invalidation endpoint for explicit logout

### Type Mismatch in Supabase Responses (Array vs Single Object)

**Issue:** Some Supabase queries can return either an object or array depending on PostgREST configuration, causing runtime errors.

**Symptoms:**
- `firstRelation()` function exists to handle both cases but feels like a band-aid
- Code like `(dayDirect as any).event_occurrences?.events?.name_en` masks the real type

**Files:**
- `src/services/events.ts` (lines 55-80, 211-225)
- `src/services/guestList.ts` (lines 114, 125, 157)
- `src/services/performers.ts` (lines 382+, 425+, 458+)

**Fix Approach:**
1. Standardize all Supabase queries to use consistent select patterns
2. Add runtime assertion at query site: `if (Array.isArray(data)) throw new Error(...)`
3. Create helper `selectOne()` function that validates return type before processing
4. Add integration tests that verify actual Supabase response shape

## Security Considerations

### Timing Attack Risk in Session Validation

**Issue:** Although `timingSafeEqual()` is used for password comparison, session ID is retrieved from memory map with direct string equality (`sessions.get(sessionId)` checks key existence in O(1) constant-time, but that's safe). However, the comparison logic at `authenticat()` is correct but other downstream auth checks might not be.

**Files:** `src/admin/dashboardAuth.ts` (lines 21-28, 156-160)

**Current Mitigation:** Using `timingSafeEqual()` for username/password. Session lookup is inherently safe (Map.has() is constant-time).

**Recommendations:**
- Continue using `timingSafeEqual()` for all credential comparisons (current practice is good)
- Add explicit auth rate limiting to prevent brute force on `/ops/login` endpoint (currently not implemented)

### Missing CSRF Protection

**Issue:** VIP dashboard and admin endpoints are protected by session cookies but lack CSRF token validation.

**Files:**
- `src/admin/vipAdminRouter.ts` — POST endpoints for booking updates
- `src/http.ts` — `/ops/login` accepts POST without CSRF token

**Risk:**
- Attacker can forge requests from user's browser if they're logged into dashboard
- Example: `<img src="https://api.nightlife.dev/ops/booking/123/confirm">` would confirm booking

**Fix Approach:**
1. Generate CSRF token on every page load and form render
2. Validate token on all state-changing requests (POST/PUT/PATCH/DELETE)
3. Use `SameSite=Strict` cookie attribute (already in place for session cookie)
4. Consider adding CSRF middleware like `csurf` package

### API Key Exposure in Error Messages

**Issue:** Authorization errors may leak partial API key information in error responses.

**Files:** `src/auth/authorize.ts`, `src/middleware/apiKeyAuth.ts`

**Current Mitigation:** Using fingerprint instead of full key for logging. Error messages don't include key material.

**Recommendations:**
- Verify no logs or error responses include `apiKey` variable directly
- Audit all `logEvent()` calls with auth context to ensure they use `apiKeyFingerprint` not `apiKey`

### Stripe Webhook Signature Verification (Good)

**Issue:** Actually NOT an issue — webhook signature verification is properly implemented.

**Files:** `src/routes/stripeWebhook.ts` (lines 16-31)

**Current Mitigation:** Signature verified before processing any event. Missing/invalid signature returns 400. But note: always returns 200 to prevent Stripe retries (line 63), which is correct.

## Performance Bottlenecks

### Genre Filter Resolution: 1000-Row Limit

**Issue:** FIXED (2026-02-19) but document here for posterity.

**Was:** `resolveGenreEventIds()` hit Supabase 1000-row cap on `event_genres` fetch + URL length limit on `.in()` with 900+ IDs.

**Fix Applied:**
- Paginated `event_genres` fetch (100 rows at a time) to avoid truncation
- Chunked `.in()` calls (100 IDs per chunk) in `fetchOccurrencesByIds()`
- Metadata fetch also chunked

**Files:** `src/services/events.ts` (lines 231-239 — `chunkArray()` helper)

**Note:** PostgREST can't join `event_occurrences` to `event_genres` directly (no foreign key). The two-step approach (resolve IDs → fetch occurrences) is required and correct.

### Unoptimized Performer Search with Multiple Genre Resolutions

**Issue:** Performer search with genre filter may trigger redundant genre lookups.

**Files:** `src/services/performers.ts` (lines 380+, 420+)

**Current Approach:** Genre resolved separately for search filter and for enrichment in detail view. If genre is provided as input, it's looked up twice.

**Fix Approach:**
1. Cache genre ID lookups within a single function call (local map)
2. If genre filter provided, reuse result in detail enrichment
3. Add memoization decorator for external lookups in production

### N+1 Queries in Venue/Performer Upcoming Events

**Issue:** `getVenueInfo()` and `getPerformerInfo()` load venue/performer detail, then call separate function to fetch "upcoming events" — each occurrence fetches its own rows separately.

**Files:**
- `src/services/venues.ts` (line 462+) — `getVenueInfo()` calls `listUpcomingEventsByVenueId()`
- `src/services/performers.ts` (line 900+) — `getPerformerInfo()` calls `listUpcomingEventsByPerformerId()`

**Fix Approach:**
1. Batch-fetch occurrences and days in single query
2. Use Supabase's JOIN capabilities to reduce query count
3. Add query profiling in tests to assert N queries doesn't grow

## Fragile Areas

### VIP Table Availability Pricing Logic

**Issue:** 4-level pricing fallback chain is complex and fragile. Any misconfiguration at one level silently falls through to next.

**Files:** `src/services/vipTables.ts` (lines 200-431)

**Why Fragile:**
1. No explicit validation that pricing chain resolves to something sensible
2. If all 4 levels return null, `pricing_approximate: null` is allowed (should validate this)
3. `venue_open` check depends on `venue_operating_hours` table — if not populated, venues appear closed
4. Tests use mocks that don't match actual Supabase schema

**Safe Modification:**
- Add explicit assertions for each pricing level before using it
- Create unit tests with real database snapshots (not mocks)
- Add warning logs when falling through multiple levels
- Validate `min_spend` is positive integer before returning

**Test Coverage Gaps:**
- Edge case: venue with 0 rows in `venue_operating_hours` (currently relies on no-op fallback)
- Edge case: all 4 pricing levels return null (response includes `pricing_approximate: null`)
- Edge case: venue_operating_hours enabled but no matching day entry (treated as closed incorrectly?)

### Deposit Refund Calculation

**Issue:** Refund logic depends on `refund_cutoff_hours` and `partial_refund_percentage` configuration. Misconfigured values break refund calculations silently.

**Files:** `src/services/deposits.ts` (lines 100+)

**Current Logic:**
1. Fetch venue deposit config
2. Check if cancellation is within `refund_cutoff_hours`
3. Apply `partial_refund_percentage` if outside window
4. No validation of these values at calc time

**Safe Modification:**
- Add explicit validation of config values (e.g., refund_percentage must be 0-100)
- Add bounds checks: `refund_cutoff_hours` must be 1-720 (1 min to 30 days)
- Log refund calculation with all inputs for auditability
- Test with extreme values: 0 hours, 100% refund, etc.

### VIP Booking Status Transitions

**Issue:** Status state machine allows invalid transitions without explicit validation.

**Files:** `src/services/vipBookings.ts` (lines 96-105, 570+)

**Valid Transitions Not Explicit:**
- submitted → in_review, rejected, cancelled
- in_review → deposit_required, confirmed, rejected
- deposit_required → confirmed, rejected, cancelled
- confirmed → (terminal, no transitions)
- rejected → (terminal)
- cancelled → (terminal)

Currently code uses `VIP_TERMINAL_STATUSES` array but doesn't encode full state machine. Someone could add a status that makes invalid transitions possible.

**Safe Modification:**
1. Create explicit state machine definition (adjacency map)
2. Validate all transitions against it in `updateVipBookingStatus()`
3. Add unit tests for each valid and invalid transition
4. Document state diagram in code

## Scaling Limits

### In-Memory Session Map (Unbounded Growth)

**Current Capacity:** Limited only by Node.js heap memory (~1GB typical).

**Limit:** ~500K sessions at 200 bytes per session = 100MB before noticeable memory pressure. After ~10M sessions, likely OOM.

**Scaling Path:**
1. Move sessions to Supabase with TTL delete (tested on `nightlife-dev`)
2. Enables horizontal scaling (multiple server instances share session store)
3. Add Redis cache layer for faster session lookups (optional, only if Supabase latency matters)

### API Rate Limiting (Minute and Daily Quotas)

**Current Implementation:** In-memory `mcp_api_usage_minute` and `mcp_api_usage_daily` tables via Supabase.

**Limit:** Rate limiter depends on Supabase RPC performance. At 100+ requests/sec, RPC calls may become bottleneck.

**Scaling Path:**
1. Add Redis cache for minute-bucket counting (fast, in-process)
2. Keep daily count in Supabase (slower, but accurate across restarts)
3. Implement sliding window instead of fixed buckets

### VIP Dashboard Concurrent Users

**Current Capacity:** Single in-memory session map supports ~1000 concurrent dashboard users before performance degradation.

**Limit:** Each user loads full booking list on every page load (no pagination mentioned in code).

**Scaling Path:**
1. Add pagination to booking list view
2. Add filtering/search to reduce data transfer
3. Move to Supabase-backed sessions (allows multi-instance deployment)

## Dependencies at Risk

### Stripe Integration (Payment Processing)

**Risk:** Stripe API version pinned to `^20.4.0`. Breaking changes in future versions could break checkout.

**Files:** `src/services/stripe.ts`, `src/routes/stripeWebhook.ts`

**Current Mitigation:** Webhook signature verification is correct. Error handling logs but continues.

**Recommendations:**
- Pin to exact version (`20.4.0` not `^20.4.0`) once production-stable
- Add integration tests with Stripe test API keys
- Monitor Stripe changelog for deprecations

### Supabase Service Role Key (High-Risk Credential)

**Risk:** Service role key in env var grants full database access. If leaked, attacker can read/modify all data.

**Files:** `src/config.ts` (line 5), `src/db/supabase.ts`

**Current Mitigation:** Loaded from Railway secrets, not in git.

**Recommendations:**
- Rotate quarterly
- Use RLS on all tables (currently in place)
- Add audit logging for suspicious queries
- Consider using Supabase RLS + postgres session variables instead of service key

### Resend Email API (Email Delivery)

**Risk:** Email sending failures could block critical operations (VIP confirmations, deposits).

**Files:** `src/services/email.ts`, `src/services/vipBookings.ts` (line 43)

**Current Mitigation:** Errors are logged but don't block booking creation (line 62 in email.ts: `if (error || !data) return null;`)

**Recommendations:**
- Add retry logic with exponential backoff
- Queue failed sends to database for manual retry
- Monitor email delivery rates via Resend API
- Add fallback to SMTP if Resend unavailable

## Missing Critical Features

### No Email Delivery Status Tracking

**Issue:** Emails are sent but no status tracked. Can't verify if customer received confirmation.

**Files:** `src/services/email.ts` (returns null on failure)

**Impact:**
- VIP booking confirmations may silently fail to deliver
- No way to retry failed sends
- Customers left waiting without confirmation email

**Fix Approach:**
1. Add `vip_booking_emails` table to track send status
2. Store Resend message ID for tracking
3. Add `/api/v1/bookings/:id/emails` endpoint to resend
4. Implement webhook handler for Resend delivery status updates

### No Audit Trail for VIP Bookings

**Issue:** Who cancelled a booking, when, and why isn't fully tracked.

**Files:** `src/services/vipBookings.ts` — `vip_booking_status_events` tracks status but not edit history of fields like special_requests.

**Impact:**
- Can't investigate why cancellation happened
- Operators can't see change history in dashboard
- Compliance gap for financial audits

**Fix Approach:**
1. Add `vip_booking_audits` table with before/after snapshots
2. Track all field changes, not just status
3. Display audit history in dashboard detail view (code exists but sparse)

### No Notification System for Venue Staff

**Issue:** When bookings change status, venue staff aren't notified automatically.

**Files:** Missing entirely

**Impact:**
- Venue staff must manually check dashboard for new bookings
- Delayed response time to booking requests
- High operational friction

**Fix Approach:**
1. Add notification preferences per venue (email, SMS, webhook)
2. Send notifications on: booking submitted, status changed, deposit collected
3. Include booking details in notification (party size, time, customer)
4. Add webhook delivery tracking

## Test Coverage Gaps

### VIP Pricing Fallback Chain (Untested Edge Cases)

**What's Not Tested:**
- Venue with all 4 pricing levels returning null
- Venue with inconsistent `venue_operating_hours` configuration
- All tables on a given day marked "blocked"
- Boundary case: party size exactly at capacity

**Files:** `src/services/vipTables.test.ts` (lines 140+)

**Risk:** Pricing logic could fail silently in production with unusual venue configs

**Priority:** High — affects revenue and customer experience

### Guest List Submission (Missing Error Cases)

**What's Not Tested:**
- Event venue changes mid-submission (race condition)
- Guest list capacity reached between submission and confirmation
- Email collision: same customer submits twice rapidly
- Malformed event_id parameter (not UUID)

**Files:** `src/services/guestList.test.ts` (sparse)

**Risk:** Race conditions could cause double-submissions or silent failures

**Priority:** Medium — affects guest experience but not revenue-critical

### Stripe Webhook Handling (No Replay Tests)

**What's Not Tested:**
- Duplicate webhook delivery (Stripe retry)
- Out-of-order events (completed before checkout.session.created)
- Webhook for non-existent booking request
- Network timeout during handler (partial failure)

**Files:** `src/routes/stripeWebhook.ts` — No tests for edge cases

**Risk:** Payment tracking could get out of sync with Stripe

**Priority:** High — financial impact

### Dashboard Authentication (Session Hijacking)

**What's Not Tested:**
- Simultaneous login attempts (race condition on session creation)
- Session cookie tampering (invalid base64, truncated)
- Expired session with fresh password (should require re-auth)
- Multiple browser tabs sharing session (concurrent requests)

**Files:** `src/admin/dashboardAuth.test.ts` (minimal coverage)

**Risk:** Dashboard could be accessed without valid credentials

**Priority:** Critical — security issue

---

*Concerns audit: 2026-03-10*
