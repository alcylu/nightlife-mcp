import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { toNightlifeError, toolErrorResponse } from "../errors.js";
import { logEvent, recordToolResult } from "../observability/metrics.js";
import {
  claimVipRequestAfterAck,
  listVipReservations,
  listVipRequestsForAlerting,
  markVipRequestAlertSent,
  updateVipBookingStatus,
} from "../services/vipBookings.js";

export type ToolDeps = {
  supabase: SupabaseClient;
  config: AppConfig;
};

const vipStatusSchema = z.enum([
  "submitted",
  "in_review",
  "deposit_required",
  "confirmed",
  "rejected",
  "cancelled",
]);

const alertTaskSchema = z.object({
  task_id: z.string(),
  booking_request_id: z.string(),
  booking_date: z.string(),
  arrival_time: z.string(),
  party_size: z.number().int().min(1),
  customer_name: z.string(),
  customer_email: z.string(),
  customer_phone: z.string(),
  special_requests: z.string().nullable(),
  venue_id: z.string(),
  venue_name: z.string().nullable(),
  current_status: vipStatusSchema,
  request_created_at: z.string(),
  first_alerted_at: z.string().nullable(),
  last_alerted_at: z.string().nullable(),
  alert_count: z.number().int().min(0),
  escalated_at: z.string().nullable(),
  should_escalate: z.boolean(),
});

const latestTaskSchema = z.object({
  task_id: z.string(),
  status: z.enum(["pending", "claimed", "done", "failed"]),
  attempt_count: z.number().int().min(0),
  next_attempt_at: z.string().nullable(),
  claimed_by: z.string().nullable(),
  claimed_at: z.string().nullable(),
  alert_count: z.number().int().min(0).nullable(),
  last_alerted_at: z.string().nullable(),
  updated_at: z.string(),
});

const reservationSummarySchema = z.object({
  booking_request_id: z.string(),
  status: vipStatusSchema,
  status_message: z.string(),
  booking_date: z.string(),
  arrival_time: z.string(),
  party_size: z.number().int().min(1),
  customer_name: z.string(),
  customer_email: z.string(),
  customer_phone: z.string(),
  special_requests: z.string().nullable(),
  venue_id: z.string(),
  venue_name: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  latest_event_note: z.string().nullable(),
  latest_event_at: z.string().nullable(),
  latest_event_actor_type: z.enum(["customer", "agent", "ops", "system"]).nullable(),
  latest_task: latestTaskSchema.nullable(),
  deposit_status: z.string().nullable(),
  deposit_amount_jpy: z.number().nullable(),
  deposit_payment_url: z.string().nullable(),
});

export const listVipRequestsForAlertingInputSchema = {
  limit: z.number().int().min(1).max(50).optional(),
  now_iso: z.string().optional(),
};

export const listVipRequestsForAlertingOutputSchema = z.object({
  now: z.string(),
  tasks: z.array(alertTaskSchema),
});

export const listVipReservationsInputSchema = {
  limit: z.number().int().min(1).max(100).optional(),
  statuses: z.array(vipStatusSchema).min(1).max(5).optional(),
  venue_id: z.string().optional(),
  booking_date_from: z.string().optional(),
  booking_date_to: z.string().optional(),
};

export const listVipReservationsOutputSchema = z.object({
  now: z.string(),
  count: z.number().int().min(0),
  statuses: z.array(vipStatusSchema),
  reservations: z.array(reservationSummarySchema),
});

export const markVipRequestAlertSentInputSchema = {
  task_id: z.string().min(1),
  broadcast_count: z.number().int().min(0),
  escalation: z.boolean().default(false),
};

export const markVipRequestAlertSentOutputSchema = z.object({
  task_id: z.string(),
  status: z.literal("pending"),
  first_alerted_at: z.string().nullable(),
  last_alerted_at: z.string().nullable(),
  alert_count: z.number().int().min(0),
  escalated_at: z.string().nullable(),
  next_attempt_at: z.string(),
});

export const claimVipRequestAfterAckInputSchema = {
  task_id: z.string().min(1),
  agent_id: z.string().min(1),
  claimed_by_session: z.string().min(1),
  claimed_by_channel: z.string().min(1),
  claimed_by_actor: z.string().min(1),
};

export const claimVipRequestAfterAckOutputSchema = z.object({
  task_id: z.string(),
  task_status: z.literal("done"),
  booking_request_id: z.string(),
  booking_status: vipStatusSchema,
  booking_status_message: z.string(),
  booking_updated_at: z.string(),
  acknowledged_by: z.string().nullable(),
  acknowledged_channel: z.string().nullable(),
  acknowledged_session: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
});

export const updateVipBookingStatusInputSchema = {
  booking_request_id: z.string().min(1),
  to_status: vipStatusSchema,
  actor_type: z.enum(["agent", "ops", "system"]).optional(),
  note: z.string().max(500).optional(),
  status_message: z.string().max(500).optional(),
  agent_internal_note: z.string().max(1000).optional(),
};

export const updateVipBookingStatusOutputSchema = z.object({
  booking_request_id: z.string(),
  status: vipStatusSchema,
  last_updated_at: z.string(),
  status_message: z.string(),
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

export function registerVipAgentOpsTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "list_vip_reservations",
    {
      description:
        "Ops-only: list VIP reservations across outstanding statuses so operators can review all active requests and queue context.",
      inputSchema: listVipReservationsInputSchema,
      outputSchema: listVipReservationsOutputSchema,
    },
    async (args) => runTool(
      "list_vip_reservations",
      listVipReservationsOutputSchema,
      async () => listVipReservations(deps.supabase, args),
    ),
  );

  server.registerTool(
    "list_vip_requests_for_alerting",
    {
      description:
        "Ops-only: list pending VIP request tasks due for customer alerting and escalation checks.",
      inputSchema: listVipRequestsForAlertingInputSchema,
      outputSchema: listVipRequestsForAlertingOutputSchema,
    },
    async (args) => runTool(
      "list_vip_requests_for_alerting",
      listVipRequestsForAlertingOutputSchema,
      async () => listVipRequestsForAlerting(deps.supabase, args),
    ),
  );

  server.registerTool(
    "mark_vip_request_alert_sent",
    {
      description:
        "Ops-only: record alert broadcast delivery for a pending VIP request task and schedule the next retry window.",
      inputSchema: markVipRequestAlertSentInputSchema,
      outputSchema: markVipRequestAlertSentOutputSchema,
    },
    async (args) => runTool(
      "mark_vip_request_alert_sent",
      markVipRequestAlertSentOutputSchema,
      async () => markVipRequestAlertSent(deps.supabase, args),
    ),
  );

  server.registerTool(
    "claim_vip_request_after_ack",
    {
      description:
        "Ops-only: atomically claim and settle a VIP request task after a teammate acknowledges ownership.",
      inputSchema: claimVipRequestAfterAckInputSchema,
      outputSchema: claimVipRequestAfterAckOutputSchema,
    },
    async (args) => runTool(
      "claim_vip_request_after_ack",
      claimVipRequestAfterAckOutputSchema,
      async () => claimVipRequestAfterAck(deps.supabase, args),
    ),
  );

  server.registerTool(
    "update_vip_booking_status",
    {
      description:
        "Ops-only: transition a VIP booking request status (for example to confirmed, rejected, or cancelled) and write an audit event.",
      inputSchema: updateVipBookingStatusInputSchema,
      outputSchema: updateVipBookingStatusOutputSchema,
    },
    async (args) => runTool(
      "update_vip_booking_status",
      updateVipBookingStatusOutputSchema,
      async () =>
        updateVipBookingStatus(deps.supabase, {
          ...args,
          actor_type: args.actor_type ?? "ops",
        }, {
          stripeSecretKey: deps.config.stripeSecretKey ?? undefined,
          nightlifeBaseUrl: deps.config.nightlifeBaseUrl,
          resendApiKey: deps.config.resendApiKey ?? undefined,
        }),
    ),
  );
}
