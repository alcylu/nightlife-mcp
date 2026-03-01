import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toNightlifeError, toolErrorResponse } from "../errors.js";
import { logEvent, recordToolResult } from "../observability/metrics.js";
import {
  upsertVipTableAvailability,
  upsertVipVenueTables,
} from "../services/vipTables.js";

type ToolDeps = {
  supabase: SupabaseClient;
};

const vipTableStatusSchema = z.enum(["available", "held", "booked", "blocked", "unknown"]);

export const upsertVipVenueTablesInputSchema = {
  venue_id: z.string().min(1),
  tables: z.array(
    z.object({
      table_code: z.string().min(1),
      table_name: z.string().optional(),
      note: z.string().max(500).optional(),
      zone: z.string().optional(),
      capacity_min: z.number().int().min(1).optional(),
      capacity_max: z.number().int().min(1).optional(),
      is_active: z.boolean().optional(),
      default_status: vipTableStatusSchema.optional(),
      chart_shape: z.string().optional(),
      chart_x: z.number().optional(),
      chart_y: z.number().optional(),
      chart_width: z.number().optional(),
      chart_height: z.number().optional(),
      chart_rotation: z.number().optional(),
      sort_order: z.number().int().optional(),
    }),
  ).min(1).max(200),
};

export const upsertVipVenueTablesOutputSchema = z.object({
  venue_id: z.string(),
  venue_name: z.string().nullable(),
  updated_count: z.number().int().min(0),
  tables: z.array(
    z.object({
      table_id: z.string(),
      table_code: z.string(),
    }),
  ),
});

export const upsertVipTableAvailabilityInputSchema = {
  venue_id: z.string().min(1),
  booking_date: z.string().min(1),
  tables: z.array(
    z.object({
      table_code: z.string().min(1),
      status: vipTableStatusSchema,
      min_spend: z.number().min(0).optional(),
      currency: z.string().optional(),
      note: z.string().max(500).optional(),
    }),
  ).min(1).max(300),
};

export const upsertVipTableAvailabilityOutputSchema = z.object({
  venue_id: z.string(),
  venue_name: z.string().nullable(),
  booking_date: z.string(),
  updated_count: z.number().int().min(0),
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

export function registerVipTableOpsTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "upsert_vip_venue_tables",
    {
      description:
        "Ops-only: create or update venue table definitions (table code/name, capacities, and chart coordinates).",
      inputSchema: upsertVipVenueTablesInputSchema,
      outputSchema: upsertVipVenueTablesOutputSchema,
    },
    async (args) => runTool(
      "upsert_vip_venue_tables",
      upsertVipVenueTablesOutputSchema,
      async () => upsertVipVenueTables(deps.supabase, args),
    ),
  );

  server.registerTool(
    "upsert_vip_table_availability",
    {
      description:
        "Ops-only: write per-date VIP table availability status for one venue.",
      inputSchema: upsertVipTableAvailabilityInputSchema,
      outputSchema: upsertVipTableAvailabilityOutputSchema,
    },
    async (args) => runTool(
      "upsert_vip_table_availability",
      upsertVipTableAvailabilityOutputSchema,
      async () => upsertVipTableAvailability(deps.supabase, args),
    ),
  );
}
