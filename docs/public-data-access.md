# Public discovery data boundary

Public REST/MCP uses explicit response allowlists, including nested events.
Service functions and verified `ops` clients retain internal enrichment. Stdio
defaults to the public contract. A session is invalidated if its key tier changes.

| Fields / functionality | Free now | Pro now | Internal ops |
| --- | --- | --- | --- |
| Published events, lineups, admission/ticket prices, event media | Yes | Yes | Yes |
| Venue identity, address, website, venue image, schedules | Yes | Yes | Yes |
| Performer identity, type, genres, schedules, profile URL | Yes | Yes | Yes |
| Venue social links | No | Yes, where available | Yes |
| Performer bio, profile image, social profiles | No | Yes, where available | Yes |
| Follower counts, rankings, rising-star/popularity sorting | No | No | Yes |
| Heat/demand signals, source counts, heat sorting | No | No | Yes |
| VIP price endpoint/tool, minimum spends, table charts | No | No | Yes |

Open VIP venue listings retain opening hours, names and URLs but omit minimum
spend and currency. Public booking responses retain IDs/status/timestamps and
status history; price-bearing messages/notes, minimum spends, deposit amounts
and deposit checkout URLs are omitted. Internal booking workflows retain them.
This does not remove ordinary event admission or ticket-tier prices.

The public OpenAPI is derived from these same allowlists. Public MCP tool output
schemas advertise only public fields. `get_vip_pricing` is registered only for ops;
REST `/venues/:id/vip-pricing` returns 404 for all non-ops keys. Public event sort
accepts date only; performer sort accepts alphabetical/recent_activity only.

## Pro enrichment — approved 2026-10-15

Approved bundle: performer biography, primary profile image and social
profiles, plus venue social profiles. These support richer app/concierge cards
without distributing operational intelligence. Keep follower counts, internal
ranking, all demand signals and raw ticket/guest counts, VIP pricing and table
charts internal-only unless separately approved.

The v2 consumption RPC rechecks the active paid subscription period on every
request. Only its verified 2,000-request paid window grants `proProfiles`; a
legacy/manual `starter` key, env fallback or client-supplied plan does not.
REST and MCP project explicit Pro allowlists, never full internal models.
Performer search includes the primary image; detail also includes bio/socials.
Nested events stay public-safe. Missing fields are null/empty, not invented.
Existing MCP sessions must reinitialize when profile entitlement changes.
Scheduled cancellation retains access until period end; expiration/past-due
removes enrichment even if a webhook is delayed. The public OpenAPI documents
separate Free/Pro variants and no operational models.

## Compatibility and rollout

This is an intentionally breaking field restriction requested by Allen. Browser
WebMCP metadata in nightlife must stop advertising bios/social links and removed
sorts. The component forwards REST JSON directly; it does not require those fields
to render the site. No nightlife/nlt-admin source usages of the VIP pricing API
were found. Their direct Supabase UI queries are not changed by this API policy.

This restriction can ship independently of paid-checkout migrations. Regression
coverage includes real MCP discovery/calls, REST requests with Free/paid/ops
roles, nested event projections, booking side channels and public OpenAPI.
