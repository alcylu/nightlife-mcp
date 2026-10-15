import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { NightlifeError, toNightlifeError, toolErrorResponse } from "../errors.js";
import { logEvent, recordToolResult } from "../observability/metrics.js";
import { getPerformerInfo, searchPerformers } from "../services/performers.js";
import { cityUnavailableSchema, eventSummarySchema, publicEventSummarySchema } from "./schemas.js";

type ToolDeps = {
  supabase: SupabaseClient;
  config: AppConfig;
  includeInternalData?: boolean;
};

const performerSummarySchema = z.object({
  performer_id: z.string(),
  name: z.string(),
  performer_type: z.string().nullable(),
  slug: z.string().nullable(),
  follower_count: z.number().nullable(),
  ranking_score: z.number().nullable(),
  genres: z.array(z.string()),
  image_url: z.string().nullable(),
  has_upcoming_event: z.boolean(),
  next_event_date: z.string().nullable(),
  nlt_url: z.string(),
});

const searchPerformersOutputSchema = z.object({
  city: z.string(),
  date_filter: z.string().nullable(),
  performers: z.array(performerSummarySchema),
  unavailable_city: cityUnavailableSchema.nullable(),
});

const performerDetailSchema = z.object({
  performer_id: z.string(),
  name: z.string(),
  performer_type: z.string().nullable(),
  slug: z.string().nullable(),
  bio: z.string().nullable(),
  follower_count: z.number().nullable(),
  ranking_score: z.number().nullable(),
  genres: z.array(z.string()),
  image_url: z.string().nullable(),
  social_links: z.array(
    z.object({
      platform: z.string(),
      username: z.string(),
      url: z.string().nullable(),
    }),
  ),
  upcoming_events: z.array(
    z.object({
      event: eventSummarySchema,
      stage: z.string().nullable(),
      set_start_time: z.string().nullable(),
      set_end_time: z.string().nullable(),
    }),
  ),
  nlt_url: z.string(),
});

export const publicPerformerSummarySchema = performerSummarySchema.omit({ follower_count: true, ranking_score: true, image_url: true });
export const publicSearchPerformersOutputSchema = searchPerformersOutputSchema.extend({ performers: z.array(publicPerformerSummarySchema) });
export const publicPerformerDetailSchema = performerDetailSchema.omit({
  bio: true, image_url: true, social_links: true, follower_count: true, ranking_score: true,
}).extend({ upcoming_events: z.array(z.object({
  event: publicEventSummarySchema, stage: z.string().nullable(), set_start_time: z.string().nullable(), set_end_time: z.string().nullable(),
})) });

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

export function registerPerformerTools(server: McpServer, deps: ToolDeps): void {
  const searchSchema = deps.includeInternalData ? searchPerformersOutputSchema : publicSearchPerformersOutputSchema;
  const detailSchema = deps.includeInternalData ? performerDetailSchema : publicPerformerDetailSchema;
  server.registerTool(
    "search_performers",
    {
      description:
        "Search performers by city/date window with optional genre and text query filters.",
      inputSchema: {
        city: z.string().default(deps.config.defaultCity),
        date: z.string().optional(),
        genre: z.string().optional(),
        query: z.string().optional(),
        sort_by: deps.includeInternalData
          ? z.enum(["popularity", "recent_activity", "alphabetical", "rising_stars"]).default("popularity")
          : z.enum(["recent_activity", "alphabetical"]).default("alphabetical"),
        limit: z.number().int().min(1).max(20).default(10),
        offset: z.number().int().min(0).default(0),
      },
      outputSchema: searchSchema,
    },
    async (args) => runTool(
      "search_performers",
      searchSchema,
      async () => searchPerformers(deps.supabase, deps.config, args),
    ),
  );

  server.registerTool(
    "get_performer_info",
    {
      description:
        "Get public performer identity, genres and upcoming events by performer ID. Plans and higher request allowances: https://nightlife.dev/checkout. Additional Pro profile enrichment is under consideration and is not currently included.",
      inputSchema: {
        performer_id: z.string().min(1),
      },
      outputSchema: detailSchema,
    },
    async ({ performer_id }) => runTool(
      "get_performer_info",
      detailSchema,
      async () => {
        const detail = await getPerformerInfo(deps.supabase, deps.config, performer_id);
        if (!detail) {
          throw new NightlifeError(
            "PERFORMER_NOT_FOUND",
            `Performer not found: ${performer_id}`,
          );
        }
        return detail;
      },
    ),
  );
}
