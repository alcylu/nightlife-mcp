import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "../observability/metrics.js";

export const usageRequestSchema = z.object({
  request_id: z.uuid(),
  monthly_requests: z.number().int().min(1).max(100_000_000),
  website: z.union([z.literal(""), z.url().max(500).refine(v => ["https:", "http:"].includes(new URL(v).protocol), "Use an http(s) website URL")]).default(""),
  use_case: z.string().trim().min(10).max(2000),
}).strict();
export type UsageNotificationConfig = { resendApiKey: string | null; lineToken: string | null; lineUserId: string | null; emailTo: string };
export type UsageDelivery = { id: string; channel: "email" | "line"; payload: Record<string, unknown>; attempts: number; created_at: string };

export function usagePayloads(input: z.infer<typeof usageRequestSchema>, email: string, config: UsageNotificationConfig) {
  const text = `nightlife.dev — additional API usage request\n\nContact: ${email}\nRequested volume: ${input.monthly_requests.toLocaleString("en-US")} requests/month\nWebsite: ${input.website || "Not provided"}\nUse case: ${input.use_case}\n\nRequest ID: ${input.request_id}\nManual review only; no quota increase or charge has been applied.`;
  return {
    email: { from: "nightlife.dev <notifications@nightlifetokyo.com>", to: [config.emailTo], reply_to: email, subject: "nightlife.dev: additional API usage requested", text },
    line: { to: config.lineUserId, messages: [{ type: "text", text }] },
  };
}

export async function sendUsageNotification(delivery: UsageDelivery, config: UsageNotificationConfig, fetcher: typeof fetch = fetch): Promise<void> {
  const email = delivery.channel === "email";
  const token = email ? config.resendApiKey : config.lineToken;
  if (!token || (!email && !config.lineUserId)) throw new Error("channel_not_configured");
  const response = await fetcher(email ? "https://api.resend.com/emails" : "https://api.line.me/v2/bot/message/push", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(email ? { "Idempotency-Key": `usage-request/${delivery.id}` } : { "X-Line-Retry-Key": delivery.id }) },
    body: JSON.stringify(delivery.payload),
  });
  if (!response.ok && !(delivery.channel === "line" && response.status === 409 && response.headers.has("x-line-accepted-request-id"))) throw new Error(`provider_http_${response.status}`);
}

export function startUsageNotificationWorker(db: SupabaseClient, config: UsageNotificationConfig) {
  let running = false;
  let stopped = false;
  async function flush() {
    if (running || stopped) return;
    running = true;
    try {
      const { data, error } = await db.rpc("claim_mcp_usage_notifications");
      if (error) throw new Error("queue_unavailable");
      for (const delivery of (data || []) as UsageDelivery[]) {
        let failure: string | null = null;
        // Both providers retain deduplication keys for 24h. Do not retry beyond
        // that window: an ambiguous earlier send could otherwise be duplicated.
        const expired = Date.now() - Date.parse(delivery.created_at) >= 23 * 3600_000;
        if (expired) failure = "retry_window_expired";
        else try { await sendUsageNotification(delivery, config); } catch (e) { failure = e instanceof Error && /^(provider_http_\d+|channel_not_configured)$/.test(e.message) ? e.message : "delivery_unavailable"; }
        const failed = !!failure && (expired || delivery.attempts >= 8);
        const { error: updateError } = await db.from("mcp_usage_notifications").update({
          state: failure ? (failed ? "failed" : "pending") : "sent",
          sent_at: failure ? null : new Date().toISOString(), last_error: failure,
          next_attempt_at: new Date(Date.now() + Math.min(2 ** delivery.attempts, 360) * 60_000).toISOString(),
        }).eq("id", delivery.id);
        if (updateError) throw new Error("delivery_status_unavailable");
        logEvent("usage_request.notification", { delivery_id: delivery.id, channel: delivery.channel, state: failure ? (failed ? "failed" : "retry") : "sent" });
      }
    } catch { logEvent("usage_request.queue_unavailable", {}); }
    finally { running = false; }
  }
  const timer = setInterval(() => { void flush(); }, 60_000);
  timer.unref();
  void flush();
  return { flush, stop() { stopped = true; clearInterval(timer); } };
}
