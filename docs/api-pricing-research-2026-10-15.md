# Nightlife API pricing — research and launch decision

Official sources checked October 15, 2026. These are different data products;
prices are useful benchmarks, not evidence of our customers' willingness to pay.

| API | Free allowance | Paid model | What we take from it |
| --- | --- | --- | --- |
| [SerpApi](https://serpapi.com/pricing) | 250 searches/month | $25/1,000; $75/5,000; $150/15,000 monthly | Small recurring sandbox, monthly paid bundles, falling unit price at scale |
| [Foursquare Places](https://docs.foursquare.com/developer/reference/upcoming-changes) | 500 Pro calls under June 1, 2026 schedule | $15/1,000 calls through 100,000, then volume discounts | Place data has a meaningful per-call value; avoid unlimited low-price access |
| [Yelp Places](https://docs.developer.yelp.com/docs/places-faq) | 5,000 calls over a 30-day evaluation | Paid plans include 30,000/month, overages in blocks of 1,000; price requires signup | Separate evaluation from commercial usage; publish a clear monthly allowance |
| [Ticketmaster Discovery](https://developer.ticketmaster.com/products-and-docs/apis/discovery/v2/) | Default quota 5,000 calls/day | Developer distribution access; no comparable public subscription price | Not an appropriate paid data-price anchor |
| [PredictHQ](https://www.predicthq.com/pricing) | Free trial, no card | Demo/sales-led; no public dollar price on current page | Custom enterprise pricing once integrations justify it |

Foursquare's product marketing page still mentions a 10,000-call test allowance;
the dated developer pricing change says 500 from June 1, 2026. Use the newer
explicit rate schedule, and confirm in their console before budgeting purchases.
Ticketmaster pages disagree on per-second limits, so the comparison uses only
the consistent 5,000/day figure. Do not confuse predicthq.com with predicthq.org.

## Implemented launch experiment

| Plan | Monthly price | Account allowance | Burst limit |
| --- | --- | --- | --- |
| Free | $0 | 100/calendar month (UTC) | 5/minute per key |
| Pro | US$19 | 2,000/paid billing period | 30/minute per key |
| Enterprise | Custom | Agreed volume | Agreed limit |

Up to three keys share ONE monthly account allowance. No rollover, automatic
top-up or surprise overage invoice. REST data requests and MCP tool calls count;
MCP initialization, tool listing, notifications and keep-alives do not. Burst
rate limiting still applies to control traffic. Internal/browser/ops keys retain
their independently configured allowances. Environment fallback is disabled at
activation so the previously exposed key cannot bypass the subscription model.

The old 100/day free tier supplied about 3,000/month per key (~9,000 with three
keys). The old Pro proposal supplied about 30,000/month per key. Reducing Free to
100/month creates a usable testing threshold, while Pro's $9.50/1,000 requests is
below the cited entry unit prices. The lower US$19 entry price accounts for our
narrower Tokyo nightlife coverage and unproven paid demand. This is our judgment,
not a market-proven optimum or a margin calculation; collection/curation costs
have not been fully attributed per request.

Start with one paid tier to make conversion interpretable. Add a volume tier
only when buyers hit the cap or ask for it. Track distinct signups, started
checkouts, paid conversions, active subscriptions, cancellations and usage. Low
traffic or no sales alone cannot distinguish a pricing problem from weak
distribution; compare checkout starts against completed payments before changing
the price. Do not count internal browser traffic as customers or revenue.
