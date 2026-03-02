# Nightlife MCP for Hotel Concierge AI

## The Problem

Hotel guests in Tokyo consistently ask concierge staff the same questions every night:
- "What's happening tonight?"
- "Where should we go out?"
- "Can you book us a VIP table?"

Most hotel AI concierge systems have no access to real-time nightlife data. They either give generic answers, hallucinate venue names, or punt to "ask the front desk." This is a missed revenue opportunity — VIP table commissions alone range from 10-30% per booking.

## The Solution: nightlife-mcp

**nightlife-mcp** is an open-source MCP server that gives any AI agent real-time access to Tokyo's nightlife scene.

### What it provides
- **Event search** — Tonight's events, filtered by genre, area, date range
- **Venue profiles** — Hours, location, upcoming events, VIP availability
- **Performer search** — Who's playing where and when
- **AI recommendations** — Curated picks across 10 nightlife archetypes
- **VIP table booking** — Check availability, pricing, and submit reservation requests

### Integration options
- **MCP protocol** — Native MCP server at `https://api.nightlife.dev/mcp` for AI agents
- **REST API** — Standard JSON endpoints at `https://api.nightlife.dev/api/v1/` for any HTTP client
- **Interactive docs** — `https://api.nightlife.dev/api/v1/docs`
- **OpenAPI 3.1 spec** — `https://api.nightlife.dev/api/v1/openapi.json`

## Why Apaleo + Nightlife MCP

Apaleo's Agent Hub enables hotel PMS integrations via MCP. Nightlife MCP would slot in as a **guest experience tool** — the first real-time entertainment data source available to hotel AI agents.

### Hotel concierge use case

```
Guest: "We're 4 people looking for a good club tonight in Roppongi"

AI Agent (using nightlife-mcp):
→ Calls search_events(city="tokyo", date="tonight", area="roppongi")
→ Returns 8 events with venues, lineups, pricing
→ Calls get_recommendations(city="tokyo", date="tonight", area="roppongi")
→ Returns top 3 picks with personalized reasoning

Guest: "Book us a VIP table at 1 OAK"

AI Agent:
→ Calls get_vip_table_availability(venue_id, date)
→ Shows table map, pricing (¥150K-¥1M), availability
→ Calls create_vip_booking_request(venue_id, date, party_size=4, ...)
→ Booking request submitted, venue confirms within 2 hours
```

### Revenue opportunity for hotels
- **VIP table commissions**: 10-30% on bookings (¥150K+ per table)
- **Guest satisfaction**: Concierge AI that actually knows what's happening tonight
- **Upsell path**: Pair with restaurant, transportation, and experience recommendations

## Technical details

| Spec | Value |
|------|-------|
| Protocol | MCP (Streamable HTTP) + REST API |
| Auth | API key via `x-api-key` header |
| OpenAPI | 3.1.0 |
| Data freshness | Real-time (events updated daily from 50+ venue sources) |
| Coverage | Tokyo (expanding to Osaka, Kyoto, Yokohama) |
| Tools | 9 MCP tools, 8 REST endpoints |
| License | MIT (code), proprietary (data) |
| Docs | https://api.nightlife.dev/api/v1/docs |
| GitHub | https://github.com/alcylu/nightlife-mcp |

## About Nightlife Tokyo

Nightlife Tokyo (nightlifetokyo.com) is the leading nightlife event platform in Tokyo, covering 200+ venues and thousands of events. We power event discovery for consumers and now bring the same data to enterprise AI systems.

**Contact:** hello@nightlifetokyo.com
**Developer portal:** https://nightlife.dev
