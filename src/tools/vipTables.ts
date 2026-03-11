import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toNightlifeError, toolErrorResponse } from "../errors.js";
import { logEvent, recordToolResult } from "../observability/metrics.js";
import { getVipPricing } from "../services/vipPricing.js";

type ToolDeps = {
  supabase: SupabaseClient;
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
- If busy_night is true, mention the event name and that demand may be higher on that night
- When pricing_approximate is true, use hedging language ("around", "approximately") rather than stating exact figures

When venue_open is false, the venue is closed on that specific date but general pricing ranges for open nights are still included. Present the open nights and pricing to the user.`;

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
  event_name: z.string().nullable(),
  busy_night: z.boolean(),
  pricing_approximate: z.boolean(),
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
