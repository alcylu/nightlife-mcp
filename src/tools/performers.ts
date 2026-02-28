import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { NightlifeError, toNightlifeError, toolErrorResponse } from "../errors.js";
import { logEvent, recordToolResult } from "../observability/metrics.js";
import { getPerformerInfo, searchPerformers } from "../services/performers.js";
import { cityUnavailableSchema, eventSummarySchema } from "./schemas.js";

type ToolDeps = {
  supabase: SupabaseClient;
  config: AppConfig;
};

const performerSummarySchema = z.object({
  performer_id: z.string(),
  name: z.string(),
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
        sort_by: z
          .enum(["popularity", "recent_activity", "alphabetical", "rising_stars"])
          .default("popularity"),
        limit: z.number().int().min(1).max(20).default(10),
        offset: z.number().int().min(0).default(0),
      },
      outputSchema: searchPerformersOutputSchema,
    },
    async (args) => runTool(
      "search_performers",
      searchPerformersOutputSchema,
      async () => searchPerformers(deps.supabase, deps.config, args),
    ),
  );

  server.registerTool(
    "get_performer_info",
    {
      description:
        "Get performer details by performer ID, including social links and upcoming events snapshot.",
      inputSchema: {
        performer_id: z.string().min(1),
      },
      outputSchema: performerDetailSchema,
    },
    async ({ performer_id }) => runTool(
      "get_performer_info",
      performerDetailSchema,
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
