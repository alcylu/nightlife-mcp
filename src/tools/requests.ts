import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toNightlifeError, toolErrorResponse } from "../errors.js";
import {
  logEvent,
  recordToolResult,
  recordUnmetRequestWrite,
} from "../observability/metrics.js";
import { logUnmetRequest } from "../services/requests.js";

type ToolDeps = {
  supabase: SupabaseClient;
};

const unmetRequestOutputSchema = z.object({
  request_id: z.string(),
  status: z.string(),
  created_at: z.string(),
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
    recordUnmetRequestWrite(true);
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
    recordUnmetRequestWrite(false);
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

export function registerRequestTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "log_unmet_request",
    {
      description:
        "Log unmet user intent when no good nightlife answer is available, for product follow-up.",
      inputSchema: {
        channel: z.string().optional(),
        language: z.string().optional(),
        city: z.string().optional(),
        raw_query: z.string().min(1),
        intent: z.string().optional(),
        suggested_filters: z.record(z.string(), z.unknown()).optional(),
        user_hash: z.string().optional(),
      },
      outputSchema: unmetRequestOutputSchema,
    },
    async (args) => runTool(
      "log_unmet_request",
      unmetRequestOutputSchema,
      async () => logUnmetRequest(deps.supabase, args),
    ),
  );
}
