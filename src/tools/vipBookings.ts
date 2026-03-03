import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toNightlifeError, toolErrorResponse } from "../errors.js";
import { logEvent, recordToolResult } from "../observability/metrics.js";
import {
  createVipBookingRequest,
  getVipBookingStatus,
} from "../services/vipBookings.js";

export type ToolDeps = {
  supabase: SupabaseClient;
};

export const createVipBookingInputSchema = {
  venue_id: z.string().min(1),
  booking_date: z.string().min(1),
  arrival_time: z.string().min(1),
  party_size: z.number().int().min(1).max(30),
  customer_name: z.string().min(1),
  customer_email: z.string().min(1),
  customer_phone: z.string().min(1),
  preferred_table_code: z.string().optional(),
  special_requests: z.string().optional(),
};

export const createVipBookingOutputSchema = z.object({
  booking_request_id: z.string(),
  status: z.enum(["submitted", "in_review", "confirmed", "rejected", "cancelled"]),
  created_at: z.string(),
  message: z.string(),
  preferred_table_code: z.string().nullable(),
  min_spend: z.number().nullable(),
  min_spend_currency: z.string().nullable(),
  table_warning: z.string().nullable(),
});

const vipBookingHistorySchema = z.object({
  status: z.enum(["submitted", "in_review", "confirmed", "rejected", "cancelled"]),
  at: z.string(),
  note: z.string().nullable(),
});

export const vipBookingStatusInputSchema = {
  booking_request_id: z.string().min(1),
  customer_email: z.string().optional(),
  customer_phone: z.string().optional(),
};

export const vipBookingStatusOutputSchema = z.object({
  booking_request_id: z.string(),
  status: z.enum(["submitted", "in_review", "confirmed", "rejected", "cancelled"]),
  last_updated_at: z.string(),
  status_message: z.string(),
  latest_note: z.string().nullable(),
  history: z.array(vipBookingHistorySchema),
});

export const createVipBookingToolDescription = [
  "Create a VIP table booking request and send it directly to the venue booking desk.",
  "The venue must have vip_booking_supported=true.",
  "Before calling this tool, always confirm booking date and arrival time in venue local time.",
  "Use dual-date wording to avoid midnight confusion.",
  "For arrivals from 00:00 to 05:59, explicitly include next calendar day in the confirmation.",
  "Required template: Just to confirm: you want a table for [Night Day] night ([Night Date]), arriving around [Time] on [Arrival Day], [Arrival Date] ([Timezone]). I'll submit that as [Night Day] night with [Time] arrival. Is that correct?",
  "If the user gives a time like 2am without a day, ask: Do you mean 2:00 AM after Thursday night (Friday morning), or after Friday night (Saturday morning)?",
  "If the user changes the requested day, regenerate confirmation before calling this tool.",
].join(" ");

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

export function registerVipBookingTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "create_vip_booking_request",
    {
      description: createVipBookingToolDescription,
      inputSchema: createVipBookingInputSchema,
      outputSchema: createVipBookingOutputSchema,
    },
    async (args) => runTool(
      "create_vip_booking_request",
      createVipBookingOutputSchema,
      async () => createVipBookingRequest(deps.supabase, args),
    ),
  );

  server.registerTool(
    "get_vip_booking_status",
    {
      description:
        "Fetch VIP booking status from the venue booking workflow. Requires booking request ID and matching customer email or phone.",
      inputSchema: vipBookingStatusInputSchema,
      outputSchema: vipBookingStatusOutputSchema,
    },
    async (args) => runTool(
      "get_vip_booking_status",
      vipBookingStatusOutputSchema,
      async () => getVipBookingStatus(deps.supabase, args),
    ),
  );
}
