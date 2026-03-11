// OpenAPI 3.1 spec for Nightlife Tokyo REST API v1
// Built manually from the Zod schemas in tools/*.ts

const eventSummary = {
  type: "object",
  properties: {
    event_id: { type: "string" },
    name: { type: "string" },
    date: { type: "string" },
    service_date: { type: ["string", "null"] },
    venue: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        area: { type: ["string", "null"] },
      },
      required: ["id", "name", "area"],
    },
    performers: { type: "array", items: { type: "string" } },
    genres: { type: "array", items: { type: "string" } },
    price: { type: ["string", "null"] },
    flyer_url: { type: ["string", "null"] },
    nlt_url: { type: "string" },
  },
  required: ["event_id", "name", "date", "service_date", "venue", "performers", "genres", "price", "flyer_url", "nlt_url"],
} as const;

const cityUnavailable = {
  type: "object",
  properties: {
    requested_city: { type: "string" },
    message: { type: "string" },
    available_cities: { type: "array", items: { type: "string" } },
    request_city_url: { type: "string" },
  },
  required: ["requested_city", "message", "available_cities", "request_city_url"],
} as const;

const errorResponse = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
      required: ["code", "message"],
    },
  },
  required: ["error"],
} as const;

// --- Shared query parameters ---
const cityParam = { name: "city", in: "query", schema: { type: "string" }, description: "City slug (default: tokyo)", required: false };
const dateParam = { name: "date", in: "query", schema: { type: "string" }, description: "Date filter: tonight, this_weekend, YYYY-MM-DD, or YYYY-MM-DD/YYYY-MM-DD", required: false };
const genreParam = { name: "genre", in: "query", schema: { type: "string" }, description: "Filter by genre (e.g. techno, house)", required: false };
const areaParam = { name: "area", in: "query", schema: { type: "string" }, description: "Filter by area (e.g. shibuya, roppongi)", required: false };
const queryParam = { name: "query", in: "query", schema: { type: "string" }, description: "Free-text search query", required: false };
const limitParam = { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 20, default: 10 }, description: "Max results (default: 10, max: 20)", required: false };
const offsetParam = { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 }, description: "Pagination offset (default: 0)", required: false };
const idParam = (resource: string) => ({ name: "id", in: "path", schema: { type: "string", format: "uuid" }, description: `${resource} UUID`, required: true });

const auth401 = { description: "API key required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
const notFound = (what: string) => ({ description: `${what} not found`, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Nightlife Tokyo API",
    version: "1.0.0",
    description: "Real-time nightlife event data for Tokyo — events, venues, performers, and recommendations. Get your API key at https://nightlife.dev",
    contact: {
      name: "Nightlife Tokyo",
      email: "hello@nightlifetokyo.com",
      url: "https://nightlife.dev",
    },
    license: {
      name: "MIT",
      url: "https://github.com/alcylu/nightlife-mcp/blob/main/LICENSE",
    },
  },
  servers: [
    { url: "https://api.nightlife.dev/api/v1", description: "Production" },
  ],
  security: [
    { ApiKeyHeader: [] },
    { BearerAuth: [] },
  ],
  tags: [
    { name: "Events", description: "Search and retrieve nightlife events" },
    { name: "Venues", description: "Search and retrieve venue profiles" },
    { name: "Performers", description: "Search and retrieve performer profiles" },
    { name: "Recommendations", description: "AI-curated nightlife recommendations" },
    { name: "Helpers", description: "Discover valid filter values (cities, genres, areas)" },
  ],
  paths: {
    "/events": {
      get: {
        summary: "Search events",
        description: "Search nightlife events with filters for city, date, genre, area, and free-text query.",
        operationId: "searchEvents",
        tags: ["Events"],
        parameters: [cityParam, dateParam, genreParam, areaParam, queryParam, limitParam, offsetParam],
        responses: {
          "200": {
            description: "Event search results",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SearchEventsOutput" } } },
          },
          "401": auth401,
        },
      },
    },
    "/events/tonight": {
      get: {
        summary: "Get tonight's events",
        description: "Get tonight's events using service-day-aware cutoff logic (6am JST rollover). At 2am Saturday, 'tonight' still returns Friday night events.",
        operationId: "getEventsTonight",
        tags: ["Events"],
        parameters: [cityParam, genreParam, areaParam, limitParam, offsetParam],
        responses: {
          "200": {
            description: "Tonight's events",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SearchEventsOutput" } } },
          },
          "401": auth401,
        },
      },
    },
    "/events/{id}": {
      get: {
        summary: "Get event details",
        description: "Get full details for a specific event by UUID, including lineup, pricing tiers, and venue info.",
        operationId: "getEventDetails",
        tags: ["Events"],
        parameters: [idParam("Event")],
        responses: {
          "200": {
            description: "Event details",
            content: { "application/json": { schema: { $ref: "#/components/schemas/EventDetail" } } },
          },
          "401": auth401,
          "404": notFound("Event"),
        },
      },
    },
    "/venues": {
      get: {
        summary: "Search venues",
        description: "Search nightlife venues by city, date window, area, genre, and text query.",
        operationId: "searchVenues",
        tags: ["Venues"],
        parameters: [cityParam, dateParam, areaParam, genreParam, queryParam, limitParam, offsetParam],
        responses: {
          "200": {
            description: "Venue search results",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SearchVenuesOutput" } } },
          },
          "401": auth401,
        },
      },
    },
    "/venues/{id}": {
      get: {
        summary: "Get venue details",
        description: "Get full venue profile including social links, upcoming events, and VIP booking availability.",
        operationId: "getVenueDetails",
        tags: ["Venues"],
        parameters: [idParam("Venue")],
        responses: {
          "200": {
            description: "Venue details",
            content: { "application/json": { schema: { $ref: "#/components/schemas/VenueDetail" } } },
          },
          "401": auth401,
          "404": notFound("Venue"),
        },
      },
    },
    "/venues/{id}/vip-pricing": {
      get: {
        operationId: "getVenueVipPricing",
        summary: "Get VIP pricing for a venue",
        description: "Returns weekday and weekend minimum spend ranges, zone summaries, table chart image URL, and booking affordance for VIP tables at a venue.",
        tags: ["Venues"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
            description: "Venue UUID",
          },
          {
            name: "date",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Date to check venue open status. Use 'tonight' for service-day-aware resolution or YYYY-MM-DD for a specific date.",
          },
        ],
        responses: {
          "200": {
            description: "VIP pricing information",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    venue_id: { type: "string", format: "uuid" },
                    venue_name: { type: "string", nullable: true },
                    venue_open: { type: "boolean" },
                    venue_closed_message: { type: "string", nullable: true },
                    pricing_configured: { type: "boolean" },
                    pricing_not_configured_message: { type: "string", nullable: true },
                    weekday_min_spend: { type: "number", nullable: true },
                    weekend_min_spend: { type: "number", nullable: true },
                    currency: { type: "string" },
                    zones: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          zone: { type: "string" },
                          capacity_min: { type: "integer", nullable: true },
                          capacity_max: { type: "integer", nullable: true },
                          weekday_min_spend: { type: "number", nullable: true },
                          weekend_min_spend: { type: "number", nullable: true },
                          currency: { type: "string" },
                        },
                      },
                    },
                    layout_image_url: { type: "string", nullable: true },
                    booking_supported: { type: "boolean" },
                    booking_note: { type: "string", nullable: true },
                    generated_at: { type: "string", format: "date-time" },
                    service_date: { type: "string", nullable: true },
                    event_pricing_note: { type: "string", nullable: true },
                    event_name: { type: "string", nullable: true, description: "Name of event happening on the requested date, or null if no event" },
                    busy_night: { type: "boolean", description: "True when an event exists on the requested date" },
                    pricing_approximate: { type: "boolean", description: "True when pricing comes from venue-level default rather than per-day defaults" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid request (bad venue ID format)" },
          "401": auth401,
          "404": notFound("Venue"),
          "500": { description: "Internal server error" },
        },
      },
    },
    "/performers": {
      get: {
        summary: "Search performers",
        description: "Search performers active in a city/date window with optional genre and text filters.",
        operationId: "searchPerformers",
        tags: ["Performers"],
        parameters: [
          cityParam, dateParam, genreParam, queryParam,
          { name: "sort_by", in: "query", schema: { type: "string", enum: ["popularity", "recent_activity", "alphabetical", "rising_stars"], default: "popularity" }, description: "Sort order", required: false },
          limitParam, offsetParam,
        ],
        responses: {
          "200": {
            description: "Performer search results",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SearchPerformersOutput" } } },
          },
          "401": auth401,
        },
      },
    },
    "/performers/{id}": {
      get: {
        summary: "Get performer details",
        description: "Get performer profile including bio, social links, and upcoming events with set times.",
        operationId: "getPerformerDetails",
        tags: ["Performers"],
        parameters: [idParam("Performer")],
        responses: {
          "200": {
            description: "Performer details",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PerformerDetail" } } },
          },
          "401": auth401,
          "404": notFound("Performer"),
        },
      },
    },
    "/cities": {
      get: {
        summary: "List cities",
        description: "List all available cities with metadata. Use this to discover valid city slugs before calling other endpoints.",
        operationId: "listCities",
        tags: ["Helpers"],
        parameters: [],
        responses: {
          "200": {
            description: "List of available cities",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ListCitiesOutput" } } },
          },
          "401": auth401,
        },
      },
    },
    "/genres": {
      get: {
        summary: "List genres",
        description: "List all available genres. Use this to discover valid genre names before filtering events or venues.",
        operationId: "listGenres",
        tags: ["Helpers"],
        parameters: [],
        responses: {
          "200": {
            description: "List of available genres",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ListGenresOutput" } } },
          },
          "401": auth401,
        },
      },
    },
    "/areas": {
      get: {
        summary: "List areas",
        description: "List distinct area/neighborhood names for a given city. Use this to discover valid area filter values.",
        operationId: "listAreas",
        tags: ["Helpers"],
        parameters: [
          { name: "city", in: "query", schema: { type: "string" }, description: "City slug (default: tokyo)", required: false },
        ],
        responses: {
          "200": {
            description: "List of areas for the city",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ListAreasOutput" } } },
          },
          "401": auth401,
        },
      },
    },
    "/recommendations": {
      get: {
        summary: "Get recommendations",
        description: "Get up to 10 diverse recommendation slots across nightlife modal archetypes with dynamic fallback.",
        operationId: "getRecommendations",
        tags: ["Recommendations"],
        parameters: [cityParam, dateParam, areaParam, genreParam, queryParam, { ...limitParam, schema: { type: "integer", minimum: 1, maximum: 10, default: 10 } }],
        responses: {
          "200": {
            description: "Curated recommendations",
            content: { "application/json": { schema: { $ref: "#/components/schemas/RecommendationsOutput" } } },
          },
          "401": auth401,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyHeader: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "API key from nightlife.dev dashboard",
      },
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "API key as Bearer token in Authorization header",
      },
    },
    schemas: {
      Error: errorResponse,
      EventSummary: eventSummary,
      CityUnavailable: cityUnavailable,
      SearchEventsOutput: {
        type: "object",
        properties: {
          city: { type: "string" },
          date_filter: { type: ["string", "null"] },
          events: { type: "array", items: { $ref: "#/components/schemas/EventSummary" } },
          unavailable_city: { oneOf: [{ $ref: "#/components/schemas/CityUnavailable" }, { type: "null" }] },
        },
        required: ["city", "date_filter", "events", "unavailable_city"],
      },
      EventDetail: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          name: { type: "string" },
          date: { type: "string" },
          start_time: { type: ["string", "null"] },
          end_time: { type: ["string", "null"] },
          service_date: { type: ["string", "null"] },
          venue: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              area: { type: ["string", "null"] },
              address: { type: ["string", "null"] },
              map_link: { type: ["string", "null"] },
              website: { type: ["string", "null"] },
            },
            required: ["id", "name", "area", "address", "map_link", "website"],
          },
          lineup: {
            type: "array",
            items: {
              type: "object",
              properties: {
                stage: { type: ["string", "null"] },
                performer_name: { type: "string" },
                start_time: { type: ["string", "null"] },
                end_time: { type: ["string", "null"] },
              },
              required: ["stage", "performer_name", "start_time", "end_time"],
            },
          },
          genres: { type: "array", items: { type: "string" } },
          price: {
            type: "object",
            properties: {
              entrance_summary: { type: ["string", "null"] },
              door: { type: ["string", "null"] },
              advance: { type: ["string", "null"] },
              tiers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    tier_name: { type: "string" },
                    price: { type: ["number", "null"] },
                    currency: { type: ["string", "null"] },
                    status: { type: "string" },
                    url: { type: ["string", "null"] },
                    provider: { type: ["string", "null"] },
                  },
                  required: ["tier_name", "price", "currency", "status", "url", "provider"],
                },
              },
            },
            required: ["entrance_summary", "door", "advance", "tiers"],
          },
          flyer_url: { type: ["string", "null"] },
          guest_list_status: { type: "string", enum: ["available", "full", "closed"] },
          nlt_url: { type: "string" },
        },
        required: ["event_id", "name", "date", "start_time", "end_time", "service_date", "venue", "lineup", "genres", "price", "flyer_url", "guest_list_status", "nlt_url"],
      },
      VenueSummary: {
        type: "object",
        properties: {
          venue_id: { type: "string" },
          name: { type: "string" },
          area: { type: ["string", "null"] },
          address: { type: ["string", "null"] },
          website: { type: ["string", "null"] },
          image_url: { type: ["string", "null"] },
          vip_booking_supported: { type: "boolean" },
          upcoming_event_count: { type: "integer", minimum: 0 },
          next_event_date: { type: ["string", "null"] },
          genres: { type: "array", items: { type: "string" } },
          nlt_url: { type: "string" },
        },
        required: ["venue_id", "name", "area", "address", "website", "image_url", "vip_booking_supported", "upcoming_event_count", "next_event_date", "genres", "nlt_url"],
      },
      SearchVenuesOutput: {
        type: "object",
        properties: {
          city: { type: "string" },
          date_filter: { type: ["string", "null"] },
          venues: { type: "array", items: { $ref: "#/components/schemas/VenueSummary" } },
          unavailable_city: { oneOf: [{ $ref: "#/components/schemas/CityUnavailable" }, { type: "null" }] },
        },
        required: ["city", "date_filter", "venues", "unavailable_city"],
      },
      VenueDetail: {
        type: "object",
        properties: {
          venue_id: { type: "string" },
          name: { type: "string" },
          area: { type: ["string", "null"] },
          address: { type: ["string", "null"] },
          website: { type: ["string", "null"] },
          image_url: { type: ["string", "null"] },
          vip_booking_supported: { type: "boolean" },
          sns_instagram: { type: ["string", "null"] },
          sns_tiktok: { type: ["string", "null"] },
          sns_x: { type: ["string", "null"] },
          sns_youtube: { type: ["string", "null"] },
          guest_list_enabled: { type: ["boolean", "null"] },
          upcoming_event_count: { type: "integer", minimum: 0 },
          upcoming_events: { type: "array", items: { $ref: "#/components/schemas/EventSummary" } },
          nlt_url: { type: "string" },
        },
        required: ["venue_id", "name", "area", "address", "website", "image_url", "vip_booking_supported", "sns_instagram", "sns_tiktok", "sns_x", "sns_youtube", "guest_list_enabled", "upcoming_event_count", "upcoming_events", "nlt_url"],
      },
      PerformerSummary: {
        type: "object",
        properties: {
          performer_id: { type: "string" },
          name: { type: "string" },
          slug: { type: ["string", "null"] },
          follower_count: { type: ["number", "null"] },
          ranking_score: { type: ["number", "null"] },
          genres: { type: "array", items: { type: "string" } },
          image_url: { type: ["string", "null"] },
          has_upcoming_event: { type: "boolean" },
          next_event_date: { type: ["string", "null"] },
          nlt_url: { type: "string" },
        },
        required: ["performer_id", "name", "slug", "follower_count", "ranking_score", "genres", "image_url", "has_upcoming_event", "next_event_date", "nlt_url"],
      },
      SearchPerformersOutput: {
        type: "object",
        properties: {
          city: { type: "string" },
          date_filter: { type: ["string", "null"] },
          performers: { type: "array", items: { $ref: "#/components/schemas/PerformerSummary" } },
          unavailable_city: { oneOf: [{ $ref: "#/components/schemas/CityUnavailable" }, { type: "null" }] },
        },
        required: ["city", "date_filter", "performers", "unavailable_city"],
      },
      PerformerDetail: {
        type: "object",
        properties: {
          performer_id: { type: "string" },
          name: { type: "string" },
          slug: { type: ["string", "null"] },
          bio: { type: ["string", "null"] },
          follower_count: { type: ["number", "null"] },
          ranking_score: { type: ["number", "null"] },
          genres: { type: "array", items: { type: "string" } },
          image_url: { type: ["string", "null"] },
          social_links: {
            type: "array",
            items: {
              type: "object",
              properties: {
                platform: { type: "string" },
                username: { type: "string" },
                url: { type: ["string", "null"] },
              },
              required: ["platform", "username", "url"],
            },
          },
          upcoming_events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                event: { $ref: "#/components/schemas/EventSummary" },
                stage: { type: ["string", "null"] },
                set_start_time: { type: ["string", "null"] },
                set_end_time: { type: ["string", "null"] },
              },
              required: ["event", "stage", "set_start_time", "set_end_time"],
            },
          },
          nlt_url: { type: "string" },
        },
        required: ["performer_id", "name", "slug", "bio", "follower_count", "ranking_score", "genres", "image_url", "social_links", "upcoming_events", "nlt_url"],
      },
      RecommendationSlot: {
        type: "object",
        properties: {
          rank: { type: "integer", minimum: 1 },
          modal_id: { type: "string" },
          modal_name: { type: "string" },
          modal_description: { type: "string" },
          event: { $ref: "#/components/schemas/EventSummary" },
          why_this_fits: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
        },
        required: ["rank", "modal_id", "modal_name", "modal_description", "event", "why_this_fits"],
      },
      ListCitiesOutput: {
        type: "object",
        properties: {
          cities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                slug: { type: "string" },
                name: { type: "string" },
                timezone: { type: "string" },
                country_code: { type: "string" },
              },
              required: ["slug", "name", "timezone", "country_code"],
            },
          },
        },
        required: ["cities"],
      },
      ListGenresOutput: {
        type: "object",
        properties: {
          genres: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                name_en: { type: ["string", "null"] },
                name_ja: { type: ["string", "null"] },
              },
              required: ["id", "name", "name_en", "name_ja"],
            },
          },
        },
        required: ["genres"],
      },
      ListAreasOutput: {
        type: "object",
        properties: {
          city: { type: "string" },
          areas: { type: "array", items: { type: "string" } },
        },
        required: ["city", "areas"],
      },
      RecommendationsOutput: {
        type: "object",
        properties: {
          city: { type: "string" },
          date_filter: { type: ["string", "null"] },
          result_count: { type: "integer", minimum: 0 },
          recommendations: { type: "array", items: { $ref: "#/components/schemas/RecommendationSlot" } },
          unavailable_city: { oneOf: [{ $ref: "#/components/schemas/CityUnavailable" }, { type: "null" }] },
        },
        required: ["city", "date_filter", "result_count", "recommendations", "unavailable_city"],
      },
    },
  },
};
