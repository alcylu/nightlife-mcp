# Pro checkout rollout

US$29/month; no trial. Stripe-hosted card checkout, account-linked subscription,
1,000 requests/day and 60/min per user-owned key (up to 3). Internal/ops/browser
keys are unaffected. Cancellation takes effect at period end. Past-due/paused/
cancelled subscriptions use Free limits. A separate webhook retries failed updates.

## Before production approval

- `npm test`, `npm run check`, `npm run build`.
- `node scripts/test-pro-billing-db.mjs`: actual PostgreSQL upgrade/downgrade,
  stale observation, new-key inheritance, permission and revocation checks.
  Local databases only; the entire fixture is rolled back.
- Review the companion nightlife-dev checkout and its loading, unavailable,
  signed-out, cancellation, confirmed payment, and cancelled-resubscribe states.
- Dry-run `scripts/setup-pro-billing.mjs` against the existing Stripe config;
  it does not create anything unless `--apply` is passed.

## After Allen approves production

1. Apply `supabase/migrations/20261015090000_mcp_pro_billing.sql` through the
   approved Supabase migration workflow. This adds two private billing tables,
   a service-only synchronization function, a key-inheritance trigger, and removes
   direct authenticated key writes. Existing key RPC contracts are unchanged.
2. Merge/deploy this backend PR. `/billing/config` stays disabled until configured.
3. Load the scoped Railway MCP token from `~/.railway/tokens.env`. Pipe the MCP
   service's `railway variables --json` into `node scripts/setup-pro-billing.mjs
   --apply`, with that scoped token set as `RAILWAY_TOKEN`. The script creates or
   reuses the Stripe product, recurring price, portal configuration, and dedicated
   webhook, then stores IDs and signing secret directly in Railway. It never
   prints the secret. It does not change the VIP webhook or existing prices.
4. Deploy the companion nightlife-dev PR. Pricing Pro CTA goes to `/checkout`;
   signup/login return customers to checkout. `/terms` describes renewal, quotas,
   cancellation, support and stored billing data.
5. Verify config returns enabled with USD 2900/month; unauthenticated checkout
   returns 401; webhook without a signature returns 400; existing key APIs work.
   Open a checkout using a confirmed account, verify amount/recurrence/cancel
   return, and expire that unused session. Do not charge a real card for testing.
   The live end-to-end payment/webhook flow still requires a genuine first payment;
   local fixtures validate the application transitions without creating charges.

## Conversion measurement

`node scripts/pro-billing-report.mjs` prints aggregate 30-day signups, distinct
checkout starts, paid checkouts, unique buyers, active subscriptions, scheduled
cancellations and gross USD MRR, split by checkout source. It contains no emails
or raw keys. Requires server-side Supabase credentials. Signups are tagged with
`signup_app=nightlife-dev`; previous shared-auth accounts are excluded.

No visitors, checkout starts, or free signups count as revenue. Paid conversion
requires Stripe's `payment_status=paid`. MRR is the gross active subscription
run-rate, not cash collected or net revenue. No recurring monitor is created by
this change; the report can be run on demand.

If launch needs to pause, archive the Pro price in Stripe to disable new checkout.
Keep its ID and all billing secrets configured: billing status, subscription
renewals, webhooks and the portal must remain available for existing subscribers.
