import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toNightlifeError, toolErrorResponse } from "../errors.js";
import { logEvent, recordToolResult } from "../observability/metrics.js";
import { getVipTableAvailability, getVipTableChart } from "../services/vipTables.js";
import { getVipPricing } from "../services/vipPricing.js";

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
  venue_open: z.boolean(),
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
  venue_open: z.boolean().nullable(),
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
        "[DEPRECATED — use get_vip_pricing for generic pricing ranges] Get VIP table availability for a venue across one or more booking dates, with optional party-size filtering.",
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
        "[DEPRECATED — use get_vip_pricing for pricing + chart URL] Get structured VIP table chart data for a venue, with optional per-table availability status on a given date.",
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

// ---------------------------------------------------------------------------
// get_vip_pricing tool
// ---------------------------------------------------------------------------

const VIP_PRICING_DESCRIPTION = `Get VIP pricing information for a venue. Returns honest weekday and weekend minimum spend ranges, zone summaries, table chart image URL, and booking affordance.

WHEN TO CALL: When a user asks about VIP tables, VIP pricing, bottle service costs, minimum spend, or table reservations at a specific venue.

WHAT TO DO AFTER:
- Present pricing conversationally ("Weekday minimums start around ¥100K, weekends from ¥200K")
- Show table chart URL as a layout reference only — do not infer availability from the image
- If booking_supported is true and user is interested, offer to submit an inquiry via create_vip_booking_request
- Do NOT suggest specific table codes unless the user asks

DO NOT CALL when venue_open is false — no pricing is available for closed nights.`;

const vipPricingInputSchema = {
  venue_id: z.string().uuid(),
  date: z.string().optional(),
};

const vipZonePricingSummarySchema = z.object({
  zone: z.string(),
  capacity_min: z.number().int().nullable(),
  capacity_max: z.number().int().nullable(),
  weekday_min_spend: z.number().nullable(),
  weekend_min_spend: z.number().nullable(),
  currency: z.string(),
});

export const vipPricingOutputSchema = z.object({
  venue_id: z.string(),
  venue_name: z.string().nullable(),
  venue_open: z.boolean(),
  venue_closed_message: z.string().nullable(),
  pricing_configured: z.boolean(),
  pricing_not_configured_message: z.string().nullable(),
  weekday_min_spend: z.number().nullable(),
  weekend_min_spend: z.number().nullable(),
  currency: z.string(),
  zones: z.array(vipZonePricingSummarySchema),
  layout_image_url: z.string().nullable(),
  booking_supported: z.boolean(),
  booking_note: z.string().nullable(),
  generated_at: z.string(),
  service_date: z.string().nullable(),
  event_pricing_note: z.string().nullable(),
});

export function registerVipPricingTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "get_vip_pricing",
    {
      description: VIP_PRICING_DESCRIPTION,
      inputSchema: vipPricingInputSchema,
      outputSchema: vipPricingOutputSchema,
    },
    async (args) => runTool(
      "get_vip_pricing",
      vipPricingOutputSchema,
      async () => getVipPricing(deps.supabase, args),
    ),
  );
}
