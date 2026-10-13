# Nightlife MCP tool guide

## Discovery

| Intent | Tool | Notes |
|---|---|---|
| Tonight | `get_tonight` | City, genre, area, sort, pagination |
| Events/date/weekend/search | `search_events` | Date accepts `tonight`, `this_weekend`, one ISO date, or an ISO date range; optional `series_id` |
| Full event facts | `get_event_details` | Use an event occurrence UUID returned by search |
| Venue discovery | `search_venues` | Can restrict to venues supporting VIP requests |
| Venue profile | `get_venue_info` | Includes social links and upcoming events |
| Performer discovery | `search_performers` | Supports popularity, recent activity, alphabetical, and rising-star sorting |
| Performer profile | `get_performer_info` | Includes social links and upcoming appearances |
| Valid coverage/filters | `list_cities`, `list_areas`, `list_genres` | Prefer these over guessing filter spellings |
| Curated slots | `get_recommendations` | Optional deployment feature; fall back to event search if unavailable |

Event results can contain both images and videos in `event_media`. A `heat` value is an evidence-weighted demand signal; null means unknown.

## VIP tables

1. Find the venue with `search_venues(vip_booking_supported_only=true)`.
2. Call `get_vip_pricing` for the exact venue and nightlife date.
3. Explain whether pricing is configured, approximate, and whether an event makes the date a busy night.
4. Collect the fields required by `create_vip_booking_request`.
5. Confirm the nightlife date and calendar arrival time immediately before submission.
6. Use `get_vip_booking_status` for follow-up. Use `cancel_vip_booking_request` only after explicit cancellation instructions.

Never state that a table is reserved merely because a request was submitted.

## Guest lists

Use `submit_to_guest_list` only after showing and confirming the exact event and submitted personal details. Return the entry reference and use `get_guest_list_entry_status` for later checks.

## Unmet requests

`log_unmet_request` writes the request to an operational backlog. It is not a search fallback. Use it only after explaining the data gap and receiving consent to record the request.
