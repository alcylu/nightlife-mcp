import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { NightlifeError, toNightlifeError, toolErrorResponse } from "../errors.js";
import { logEvent, recordToolResult } from "../observability/metrics.js";
import {
  upsertVenueDepositConfig,
  getDepositForBooking,
  regenerateDepositCheckout,
} from "../services/deposits.js";

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

const configureVenueDepositInputSchema = {
  venue_id: z.string().min(1),
  deposit_enabled: z.boolean().optional(),
  deposit_percentage: z.number().int().min(1).max(100).optional(),
  refund_cutoff_hours: z.number().int().min(0).optional(),
  partial_refund_percentage: z.number().int().min(0).max(100).optional(),
  checkout_expiry_minutes: z.number().int().min(5).max(1440).optional(),
};

const configureVenueDepositOutputSchema = z.object({
  id: z.string(),
  venue_id: z.string(),
  deposit_enabled: z.boolean(),
  deposit_percentage: z.number(),
  refund_cutoff_hours: z.number(),
  partial_refund_percentage: z.number(),
  checkout_expiry_minutes: z.number(),
});

const depositStatusInputSchema = {
  booking_request_id: z.string().min(1),
};

const depositStatusOutputSchema = z.object({
  id: z.string(),
  booking_request_id: z.string(),
  venue_id: z.string(),
  status: z.string(),
  amount_jpy: z.number(),
  deposit_percentage: z.number(),
  min_spend_jpy: z.number(),
  stripe_checkout_url: z.string().nullable(),
  checkout_expires_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  refund_cutoff_hours: z.number(),
  partial_refund_percentage: z.number(),
  refund_amount_jpy: z.number().nullable(),
  refunded_at: z.string().nullable(),
  forfeited_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const regenerateDepositLinkInputSchema = {
  booking_request_id: z.string().min(1),
};

const regenerateDepositLinkOutputSchema = z.object({
  booking_request_id: z.string(),
  status: z.string(),
  amount_jpy: z.number(),
  stripe_checkout_url: z.string().nullable(),
  checkout_expires_at: z.string().nullable(),
});

export function registerDepositOpsTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "configure_venue_deposit",
    {
      description:
        "Ops-only: configure deposit settings for a VIP venue. Creates or updates deposit config (percentage of min_spend, refund cutoff, checkout expiry).",
      inputSchema: configureVenueDepositInputSchema,
      outputSchema: configureVenueDepositOutputSchema,
    },
    async (args) =>
      runTool("configure_venue_deposit", configureVenueDepositOutputSchema, async () =>
        upsertVenueDepositConfig(deps.supabase, args),
      ),
  );

  server.registerTool(
    "get_vip_deposit_status",
    {
      description:
        "Ops-only: get the deposit status for a VIP booking. Returns deposit amount, payment URL, expiry, paid/refund state.",
      inputSchema: depositStatusInputSchema,
      outputSchema: depositStatusOutputSchema,
    },
    async (args) =>
      runTool("get_vip_deposit_status", depositStatusOutputSchema, async () => {
        const deposit = await getDepositForBooking(deps.supabase, args.booking_request_id);
        if (!deposit) {
          throw new NightlifeError("DEPOSIT_NOT_FOUND", "No deposit found for this booking.");
        }
        return deposit;
      }),
  );

  server.registerTool(
    "regenerate_deposit_link",
    {
      description:
        "Ops-only: regenerate a Stripe payment link for an expired deposit. Only works when deposit status is 'expired'.",
      inputSchema: regenerateDepositLinkInputSchema,
      outputSchema: regenerateDepositLinkOutputSchema,
    },
    async (args) =>
      runTool("regenerate_deposit_link", regenerateDepositLinkOutputSchema, async () => {
        if (!deps.config.stripeSecretKey) {
          throw new NightlifeError("STRIPE_ERROR", "Stripe is not configured.");
        }
        const deposit = await regenerateDepositCheckout(
          deps.supabase,
          deps.config.stripeSecretKey,
          args.booking_request_id,
          deps.config.nightlifeBaseUrl,
          { resendApiKey: deps.config.resendApiKey ?? undefined },
        );
        return {
          booking_request_id: deposit.booking_request_id,
          status: deposit.status,
          amount_jpy: deposit.amount_jpy,
          stripe_checkout_url: deposit.stripe_checkout_url,
          checkout_expires_at: deposit.checkout_expires_at,
        };
      }),
  );
}
