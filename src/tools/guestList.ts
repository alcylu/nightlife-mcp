import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toNightlifeError, toolErrorResponse } from "../errors.js";
import { logEvent, recordToolResult } from "../observability/metrics.js";
import {
  submitToGuestList,
  getGuestListEntryStatus,
} from "../services/guestList.js";

export type ToolDeps = {
  supabase: SupabaseClient;
};

export const submitToGuestListInputSchema = {
  event_id: z.string().optional(),
  venue_id: z.string().optional(),
  service_date: z.string().optional(),
  customer_name: z.string().min(1),
  party_size: z.number().int().min(1).max(20).default(1),
  customer_email: z.string().min(1),
  customer_phone: z.string().optional(),
  messaging_channel: z.string().optional(),
  messaging_handle: z.string().optional(),
  language: z.string().default("en"),
  source: z.string().default("concierge"),
};

export const submitToGuestListOutputSchema = z.object({
  entry_id: z.string(),
  status: z.enum(["confirmed", "full", "closed"]),
  event_name: z.string().nullable(),
  event_date: z.string().nullable(),
  message: z.string(),
  guest_list_benefit: z.string().nullable(),
  door_instructions: z.string().nullable(),
});

export const getGuestListEntryStatusInputSchema = {
  entry_id: z.string().optional(),
  event_id: z.string().optional(),
  customer_email: z.string().optional(),
};

export const getGuestListEntryStatusOutputSchema = z.object({
  entry_id: z.string(),
  status: z.enum(["confirmed", "cancelled"]),
  customer_name: z.string(),
  party_size: z.number(),
  event_name: z.string().nullable(),
  event_date: z.string().nullable(),
  created_at: z.string(),
  guest_list_benefit: z.string().nullable(),
  door_instructions: z.string().nullable(),
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

export function registerGuestListTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "submit_to_guest_list",
    {
      description:
        "Submit a guest list entry for an event or venue. Provide either event_id or venue_id + service_date. Returns confirmation with door instructions and guest list benefits if available.",
      inputSchema: submitToGuestListInputSchema,
      outputSchema: submitToGuestListOutputSchema,
    },
    async (args) => runTool(
      "submit_to_guest_list",
      submitToGuestListOutputSchema,
      async () => submitToGuestList(deps.supabase, args),
    ),
  );

  server.registerTool(
    "get_guest_list_entry_status",
    {
      description:
        "Check the status of a guest list entry. Provide either entry_id or event_id + customer_email.",
      inputSchema: getGuestListEntryStatusInputSchema,
      outputSchema: getGuestListEntryStatusOutputSchema,
    },
    async (args) => runTool(
      "get_guest_list_entry_status",
      getGuestListEntryStatusOutputSchema,
      async () => getGuestListEntryStatus(deps.supabase, args),
    ),
  );
}
