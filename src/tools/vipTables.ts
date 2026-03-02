import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toNightlifeError, toolErrorResponse } from "../errors.js";
import { logEvent, recordToolResult } from "../observability/metrics.js";
import { getVipTableAvailability, getVipTableChart } from "../services/vipTables.js";

type ToolDeps = {
  supabase: SupabaseClient;
};

const vipTableStatusSchema = z.enum(["available", "held", "booked", "blocked", "unknown"]);

const vipTableAvailabilityTableSchema = z.object({
  table_id: z.string(),
  table_code: z.string(),
  table_name: z.string(),
  zone: z.string().nullable(),
  capacity_min: z.number().int().nullable(),
  capacity_max: z.number().int().nullable(),
  status: vipTableStatusSchema,
  min_spend: z.number().nullable(),
  currency: z.string().nullable(),
  note: z.string().nullable(),
  pricing_approximate: z.boolean(),
});

const vipTableAvailabilityDaySchema = z.object({
  booking_date: z.string(),
  available_count: z.number().int().min(0),
  total_count: z.number().int().min(0),
  tables: z.array(vipTableAvailabilityTableSchema),
});

export const vipTableAvailabilityInputSchema = {
  venue_id: z.string().min(1),
  booking_date_from: z.string().min(1),
  booking_date_to: z.string().optional(),
  party_size: z.number().int().min(1).max(30).optional(),
  include_non_available: z.boolean().optional(),
};

export const vipTableAvailabilityOutputSchema = z.object({
  venue_id: z.string(),
  venue_name: z.string().nullable(),
  booking_date_from: z.string(),
  booking_date_to: z.string(),
  party_size: z.number().int().nullable(),
  generated_at: z.string(),
  days: z.array(vipTableAvailabilityDaySchema),
});

const vipTableChartNodeSchema = z.object({
  table_id: z.string(),
  table_code: z.string(),
  table_name: z.string(),
  zone: z.string().nullable(),
  capacity_min: z.number().int().nullable(),
  capacity_max: z.number().int().nullable(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
  chart_shape: z.string(),
  chart_x: z.number().nullable(),
  chart_y: z.number().nullable(),
  chart_width: z.number().nullable(),
  chart_height: z.number().nullable(),
  chart_rotation: z.number().nullable(),
  status: vipTableStatusSchema.nullable(),
  min_spend: z.number().nullable(),
  currency: z.string().nullable(),
  note: z.string().nullable(),
  pricing_approximate: z.boolean(),
});

export const vipTableChartInputSchema = {
  venue_id: z.string().min(1),
  booking_date: z.string().optional(),
  include_inactive: z.boolean().optional(),
};

export const vipTableChartOutputSchema = z.object({
  venue_id: z.string(),
  venue_name: z.string().nullable(),
  booking_date: z.string().nullable(),
  layout_image_url: z.string().url().nullable(),
  generated_at: z.string(),
  tables: z.array(vipTableChartNodeSchema),
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

export function registerVipTableTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "get_vip_table_availability",
    {
      description:
        "Get VIP table availability for a venue across one or more booking dates, with optional party-size filtering.",
      inputSchema: vipTableAvailabilityInputSchema,
      outputSchema: vipTableAvailabilityOutputSchema,
    },
    async (args) => runTool(
      "get_vip_table_availability",
      vipTableAvailabilityOutputSchema,
      async () => getVipTableAvailability(deps.supabase, args),
    ),
  );

  server.registerTool(
    "get_vip_table_chart",
    {
      description:
        "Get structured VIP table chart data for a venue, with optional per-table availability status on a given date.",
      inputSchema: vipTableChartInputSchema,
      outputSchema: vipTableChartOutputSchema,
    },
    async (args) => runTool(
      "get_vip_table_chart",
      vipTableChartOutputSchema,
      async () => getVipTableChart(deps.supabase, args),
    ),
  );
}
