import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { NightlifeError, toNightlifeError, toolErrorResponse } from "../errors.js";
import { recordToolResult, logEvent } from "../observability/metrics.js";
import { getEventDetails, searchEvents } from "../services/events.js";

type ToolDeps = {
  supabase: SupabaseClient;
  config: AppConfig;
};

const eventSummarySchema = z.object({
  event_id: z.string(),
  name: z.string(),
  date: z.string(),
  service_date: z.string().nullable(),
  venue: z.object({
    id: z.string(),
    name: z.string(),
    area: z.string().nullable(),
  }),
  performers: z.array(z.string()),
  genres: z.array(z.string()),
  price: z.string().nullable(),
  flyer_url: z.string().nullable(),
  nlt_url: z.string(),
});

const cityUnavailableSchema = z.object({
  requested_city: z.string(),
  message: z.string(),
  available_cities: z.array(z.string()),
  request_city_url: z.string(),
});

const searchEventsOutputSchema = z.object({
  city: z.string(),
  date_filter: z.string().nullable(),
  events: z.array(eventSummarySchema),
  unavailable_city: cityUnavailableSchema.nullable(),
});

const eventDetailSchema = z.object({
  event_id: z.string(),
  name: z.string(),
  date: z.string(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  service_date: z.string().nullable(),
  venue: z.object({
    id: z.string(),
    name: z.string(),
    area: z.string().nullable(),
    address: z.string().nullable(),
    map_link: z.string().nullable(),
    website: z.string().nullable(),
  }),
  lineup: z.array(
    z.object({
      stage: z.string().nullable(),
      performer_name: z.string(),
      start_time: z.string().nullable(),
      end_time: z.string().nullable(),
    }),
  ),
  genres: z.array(z.string()),
  price: z.object({
    entrance_summary: z.string().nullable(),
    door: z.string().nullable(),
    advance: z.string().nullable(),
    tiers: z.array(
      z.object({
        tier_name: z.string(),
        price: z.number().nullable(),
        currency: z.string().nullable(),
        status: z.string(),
        url: z.string().nullable(),
        provider: z.string().nullable(),
      }),
    ),
  }),
  flyer_url: z.string().nullable(),
  guest_list_status: z.enum(["available", "full", "closed"]),
  nlt_url: z.string(),
});

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function runTool<Output>(
  toolName: string,
  outputSchema: z.ZodType<Output>,
  cb: () => Promise<Output>,
) {
  const startedAt = Date.now();
  try {
    const output = outputSchema.parse(await cb());
    const durationMs = Date.now() - startedAt;
    recordToolResult({
      tool: toolName,
      durationMs,
    });
    logEvent("tool.success", {
      tool: toolName,
      duration_ms: durationMs,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: jsonText(output),
        },
      ],
      structuredContent: output as unknown as Record<string, unknown>,
    };
  } catch (error) {
    const normalized = toNightlifeError(error);
    const durationMs = Date.now() - startedAt;
    recordToolResult({
      tool: toolName,
      durationMs,
      errorCode: normalized.code,
    });
    logEvent("tool.error", {
      tool: toolName,
      duration_ms: durationMs,
      code: normalized.code,
      message: normalized.message,
    });

    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: jsonText(toolErrorResponse(normalized)),
        },
      ],
    };
  }
}

export function registerEventTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "search_events",
    {
      description:
        "Search nightlife events. Supports city, date filters (tonight, this_weekend, ISO date, ISO range), genre, and area.",
      inputSchema: {
        city: z.string().default("tokyo"),
        date: z.string().optional(),
        genre: z.string().optional(),
        area: z.string().optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(20).default(10),
        offset: z.number().int().min(0).default(0),
      },
      outputSchema: searchEventsOutputSchema,
    },
    async (args) => runTool(
      "search_events",
      searchEventsOutputSchema,
      async () => searchEvents(deps.supabase, deps.config, args),
    ),
  );

  server.registerTool(
    "get_tonight",
    {
      description:
        "Get tonight's nightlife events using city timezone and service-day cutoff logic.",
      inputSchema: {
        city: z.string().default("tokyo"),
        genre: z.string().optional(),
        area: z.string().optional(),
        limit: z.number().int().min(1).max(20).default(10),
        offset: z.number().int().min(0).default(0),
      },
      outputSchema: searchEventsOutputSchema,
    },
    async (args) => runTool(
      "get_tonight",
      searchEventsOutputSchema,
      async () =>
        searchEvents(deps.supabase, deps.config, {
          ...args,
          date: "tonight",
        }),
    ),
  );

  server.registerTool(
    "get_event_details",
    {
      description:
        "Get full details for a specific event occurrence ID (UUID).",
      inputSchema: {
        event_id: z.string().min(1),
      },
      outputSchema: eventDetailSchema,
    },
    async ({ event_id }) => runTool(
      "get_event_details",
      eventDetailSchema,
      async () => {
        const detail = await getEventDetails(deps.supabase, deps.config, event_id);
        if (!detail) {
          throw new NightlifeError(
            "EVENT_NOT_FOUND",
            `Event not found: ${event_id}`,
          );
        }
        return detail;
      },
    ),
  );
}
