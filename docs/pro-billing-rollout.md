# Paid checkout rollout

Approved 2026-10-15: Starter US$5/month for 500 requests (10/min/key), Pro
US$19/month for 5,000 (30/min/key). Both include advanced data. No free tier or
trial; allowances shared across three keys; no automatic overages. Usage enquiries
remain available without payment and notify Allen by email and LINE.

## Release

Run backend check/test/build/test:billing:db, frontend build and desktop/mobile QA.
Both CI workflows must pass before production. Then:

1. Apply only 20261015140000_mcp_paid_plans.sql using an isolated Supabase history
   fetched from production. Check db push --dry-run; never repair shared history.
2. Dry-run then apply scripts/setup-pro-billing.mjs with scoped Railway variables
   on stdin. It reuses the Pro product/price/webhook, creates Starter and enables
   portal switching between separate Starter/Pro products (Stripe permits only one
   monthly USD price per product in the portal). Plan changes are immediate and
   prorated, without a usage reset. Secrets are never printed;
   variable updates use --skip-deploys before the explicit deployment.
3. Merge/deploy passing backend/frontend. Production enforces DB authentication,
   monthly metering and disabled env fallback. Both price IDs are required.
4. Verify both live hosted prices/recurrence without charging a card. Expire QA
   sessions and delete QA customers/accounts. Verify unpaid key issuance/access
   denied, shared browser key revoked, ordinary consumer browsing unaffected.

Initial audit found no active subscriptions. Existing subscription rows backfill
to Pro and gain 5,000 requests. Accountless keys get no public allowance unless
explicitly flagged trusted internal runtime/ops. Auth-user deletion cannot confer
internal access. Old sync RPC remains temporarily for deployment compatibility.

## Billing invariants

Server-fixed Stripe prices, DB-fenced checkout leases and idempotency prevent
duplicate subscriptions. Existing subscriptions use the portal. Actual Stripe
price determines plan, never client metadata. Active access requires a paid latest
invoice; pending upgrade payments cannot unlock Pro. Usage never resets on a
mid-period switch. Cancellation retains access until period end; expired,
past-due and paused accounts have zero allowance. Both plans expose identical data.

Local PostgreSQL/Stripe fixtures cover paid transitions, stale observations,
shared caps, permissions, plan changes and revocation. The live payment/webhook
path requires a genuine payment; do not charge a real card for QA.

## Measurement

npm run billing:report reports signups, checkout starts, paid checkouts, buyers,
active Starter/Pro subscriptions and gross MRR at US$5/US$19. Requests and signups
are not revenue. Paid conversion requires payment_status=paid. MRR is a run-rate,
not cash collected. This change does not create a recurring monitor.
