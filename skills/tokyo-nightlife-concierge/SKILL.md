---
name: tokyo-nightlife-concierge
description: Find current Tokyo nightlife events, venues, performers, guest lists, and VIP table options using the Nightlife MCP. Use when someone asks what is on tonight or this weekend, where to go out in Tokyo, who is playing, or wants help joining a guest list or requesting a VIP table.
---

# Tokyo Nightlife Concierge

Use the Nightlife MCP as the source of truth for current event, venue, performer, guest-list, and VIP information. Do not invent availability, prices, lineups, or opening status from general knowledge.

## Connection

Use the Nightlife MCP tools when they are available. If they are not available, explain that this skill requires the Nightlife MCP at `https://api.nightlife.dev/mcp` and an API key from `https://nightlife.dev`; do not silently replace live data with guesses.

Read [references/tools.md](references/tools.md) only when exact tool selection, parameters, or a write workflow is needed.

## Discovery workflow

1. Infer `city=tokyo` unless the user names another supported city. Use `list_cities`, `list_areas`, or `list_genres` only when a requested filter is unclear or unsupported.
2. For “tonight,” prefer `get_tonight`. For another date, weekend, area, genre, artist, or keyword, use `search_events`.
3. Treat a nightlife day as ending at 06:00 local time. At 02:00 Saturday, “tonight” still means Friday night.
4. For a short recommendation, fetch enough candidates, then inspect the strongest options with `get_event_details`. Prefer `sort_by=heat` only when the user asks what is hottest or most popular; otherwise keep chronological order.
5. When event search includes `vip_venues_open`, consider those venues before saying nothing is happening. They may be open without a listed event.
6. Use `search_venues` for venue-led requests and `search_performers` for artist-led requests. Follow with the corresponding detail tool before stating specifics.

## Recommendation quality

- Return a small, useful shortlist unless the user requests a complete list.
- Explain each pick using returned facts such as lineup, area, genre, time, admission, or demand signals.
- `heat: null` means unscored, not unpopular. Do not call an unscored event quiet.
- Qualify low-confidence heat scores. Equal heat scores can be supported by different amounts of evidence.
- Prefer canonical `nlt_url` links from tool results.
- State missing fields plainly. Do not infer ticket availability from a ticket URL, or VIP availability from ordinary venue hours.

## Transactions and personal data

Discovery is read-only. Before any guest-list submission or VIP booking request:

1. Show the exact event or venue, nightlife date, arrival date and time, party size, price/minimum spend when returned, and the personal details that will be submitted.
2. For arrivals from 00:00 through 05:59, explicitly distinguish the nightlife date from the calendar arrival date.
3. Ask for the user's explicit confirmation immediately before calling the mutation tool. A request to explore options is not confirmation to submit.
4. Send personal data only to the Nightlife MCP tool required for that transaction. Never place API keys or personal data in the response.
5. Return the booking/request ID and status. Describe a submitted request as pending unless the tool explicitly says confirmed.

Do not call internal ops tools, change booking status, upload table charts, configure deposits, or perform other staff actions under this consumer skill.

## Empty and failed results

- Broaden one filter at a time and tell the user what changed.
- An unavailable city is coverage information, not proof that the city has no nightlife.
- If live data fails, say it could not be verified and provide the canonical Nightlife Tokyo browse link rather than a fabricated answer.
- Do not log an unmet request unless the user agrees that their request may be recorded for service improvement.
