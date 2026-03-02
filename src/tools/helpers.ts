import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { toNightlifeError, toolErrorResponse } from "../errors.js";
import { recordToolResult, logEvent } from "../observability/metrics.js";
import { listCities } from "../services/cities.js";
import { listGenres, listAreas } from "../services/helpers.js";

type ToolDeps = {
  supabase: SupabaseClient;
  config: AppConfig;
};

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
    logEvent("tool.success", { tool: toolName, duration_ms: durationMs });

    return {
      content: [{ type: "text" as const, text: jsonText(output) }],
      structuredContent: output as unknown as Record<string, unknown>,
    };
  } catch (error) {
    const normalized = toNightlifeError(error);
    const durationMs = Date.now() - startedAt;
    recordToolResult({ tool: toolName, durationMs, errorCode: normalized.code });
    logEvent("tool.error", {
      tool: toolName,
      duration_ms: durationMs,
      code: normalized.code,
      message: normalized.message,
    });

    return {
      isError: true,
      content: [{ type: "text" as const, text: jsonText(toolErrorResponse(normalized)) }],
    };
  }
}

// --- Output schemas ---

const listCitiesOutputSchema = z.object({
  cities: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      timezone: z.string(),
      country_code: z.string(),
    }),
  ),
});

const listGenresOutputSchema = z.object({
  genres: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      name_en: z.string().nullable(),
      name_ja: z.string().nullable(),
    }),
  ),
});

const listAreasOutputSchema = z.object({
  city: z.string(),
  areas: z.array(z.string()),
});

// --- Registration ---

export function registerHelperTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "list_cities",
    {
      description:
        "List all available cities with metadata. Use this to discover valid city slugs before calling other tools.",
      inputSchema: {},
      outputSchema: listCitiesOutputSchema,
    },
    async () =>
      runTool("list_cities", listCitiesOutputSchema, async () =>
        listCities(deps.supabase, deps.config.topLevelCities),
      ),
  );

  server.registerTool(
    "list_genres",
    {
      description:
        "List all available genres. Use this to discover valid genre names before filtering events or venues.",
      inputSchema: {},
      outputSchema: listGenresOutputSchema,
    },
    async () =>
      runTool("list_genres", listGenresOutputSchema, async () =>
        listGenres(deps.supabase),
      ),
  );

  server.registerTool(
    "list_areas",
    {
      description:
        "List distinct area/neighborhood names for a given city. Use this to discover valid area filters.",
      inputSchema: {
        city: z
          .string()
          .optional()
          .describe("City slug (defaults to tokyo)"),
      },
      outputSchema: listAreasOutputSchema,
    },
    async ({ city }) =>
      runTool("list_areas", listAreasOutputSchema, async () =>
        listAreas(deps.supabase, deps.config, city),
      ),
  );
}
