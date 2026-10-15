# Paid public data boundary

Remote REST/MCP requires Starter (US$5/month, 500 requests, 10/min per key) or Pro
(US$19/month, 5,000 requests, 30/min per key). No free API tier. Monthly usage is
shared across up to three keys. Both plans include the same advanced data.

| Data | Starter / Pro | Internal ops |
| --- | --- | --- |
| Published events, lineups, ordinary admission/ticket prices, event media | Yes | Yes |
| Venue identity, address, website, image, schedules | Yes | Yes |
| Performer identity, genres, schedules, profile URL | Yes | Yes |
| Venue socials; performer bio, primary image, social profiles | Where available | Yes |
| Demand/heat signals, source counts, heat sorting | No | Yes |
| Follower counts, rankings, popularity sorting | No | Yes |
| VIP pricing, minimum spends, table charts | No | Yes |

Explicit nested allowlists prevent leaking internal models. Missing enrichment
is null/empty. Public event sorts allow date only; performer sorts allow
alphabetical/recent_activity. OpenAPI advertises enriched paid responses using
legacy Pro* schema names for compatibility. Public booking responses omit
price-bearing messages/notes, deposits, deposit URLs and minimum spends while
retaining IDs/status/timestamps/history. Public VIP venue listings omit spend and
currency. VIP-price endpoint/tool remains ops-only.

The v2 consumption RPC rechecks each paid period. Verified 500/5,000 windows grant
proProfiles; client claims and manual key tiers do not. Unpaid/expired/past-due
accounts have no allowance, cannot issue keys, and receive HTTP 402 including MCP
setup. Paid MCP control traffic is unmetered. Cancellation retains access until
period end. Usage does not reset on a mid-period upgrade; the latest invoice must
be paid before a larger limit is granted. Portal plan changes are immediate and
prorated; downgrading after 500 requests leaves no remaining Starter allowance.

Only explicit DB-only internal_access flags preserve private runtime/ops keys.
NULL user_id does not confer internal access. Production requires DB metering and
forbids env fallback. Local stdio needs private server credentials and defaults to
a basic safe projection; it is not an unpaid remote service.

The paid-plans migration revokes the shared consumer-browser key. Agents must
connect to the remote MCP/API with their own paid key. Normal consumer rendering
uses separate Supabase queries and is unchanged. Regression coverage includes
MCP/REST, nested projections, booking side channels, OpenAPI and PostgreSQL
permissions, orphaned keys, expiry, plan changes and shared usage caps.
