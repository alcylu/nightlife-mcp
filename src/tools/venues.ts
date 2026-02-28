import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { NightlifeError, toNightlifeError, toolErrorResponse } from "../errors.js";
import { logEvent, recordToolResult } from "../observability/metrics.js";
import { getVenueInfo, searchVenues } from "../services/venues.js";
import { cityUnavailableSchema, eventSummarySchema } from "./schemas.js";

type ToolDeps = {
  supabase: SupabaseClient;
  config: AppConfig;
};

const venueSummarySchema = z.object({
  venue_id: z.string(),
  name: z.string(),
  area: z.string().nullable(),
  address: z.string().nullable(),
  website: z.string().nullable(),
  image_url: z.string().nullable(),
  vip_booking_supported: z.boolean(),
  upcoming_event_count: z.number().int().min(0),
  next_event_date: z.string().nullable(),
  genres: z.array(z.string()),
  nlt_url: z.string(),
});

const searchVenuesOutputSchema = z.object({
  city: z.string(),
  date_filter: z.string().nullable(),
  venues: z.array(venueSummarySchema),
  unavailable_city: cityUnavailableSchema.nullable(),
});

const venueDetailSchema = z.object({
  venue_id: z.string(),
  name: z.string(),
  area: z.string().nullable(),
  address: z.string().nullable(),
  website: z.string().nullable(),
  image_url: z.string().nullable(),
  vip_booking_supported: z.boolean(),
  sns_instagram: z.string().nullable(),
  sns_tiktok: z.string().nullable(),
  sns_x: z.string().nullable(),
  sns_youtube: z.string().nullable(),
  guest_list_enabled: z.boolean().nullable(),
  upcoming_event_count: z.number().int().min(0),
  upcoming_events: z.array(eventSummarySchema),
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
    recordToolResult({ tool: toolName, durationMs });
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

export function registerVenueTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "search_venues",
    {
      description:
        "Search nightlife venues by city/date window and optional area, genre, text query, and VIP booking support.",
      inputSchema: {
        city: z.string().default(deps.config.defaultCity),
        date: z.string().optional(),
        area: z.string().optional(),
        genre: z.string().optional(),
        query: z.string().optional(),
        vip_booking_supported_only: z.boolean().optional(),
        limit: z.number().int().min(1).max(20).default(10),
        offset: z.number().int().min(0).default(0),
      },
      outputSchema: searchVenuesOutputSchema,
    },
    async (args) => runTool(
      "search_venues",
      searchVenuesOutputSchema,
      async () => searchVenues(deps.supabase, deps.config, args),
    ),
  );

  server.registerTool(
    "get_venue_info",
    {
      description:
        "Get full details for a specific venue ID, including upcoming events and VIP booking support.",
      inputSchema: {
        venue_id: z.string().min(1),
      },
      outputSchema: venueDetailSchema,
    },
    async ({ venue_id }) => runTool(
      "get_venue_info",
      venueDetailSchema,
      async () => {
        const detail = await getVenueInfo(deps.supabase, deps.config, venue_id);
        if (!detail) {
          throw new NightlifeError("VENUE_NOT_FOUND", `Venue not found: ${venue_id}`);
        }
        return detail;
      },
    ),
  );
}
