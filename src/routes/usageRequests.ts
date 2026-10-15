import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { usageRequestSchema, usagePayloads, type UsageNotificationConfig } from "../services/usageRequests.js";

export function createUsageRequestRouter(db: SupabaseClient, config: UsageNotificationConfig, flush: () => Promise<void>) {
  const router = Router();
  router.post("/usage-request", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const token = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!token) { res.status(401).json({ error: "Please sign in to request more usage." }); return; }
    try {
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user?.email_confirmed_at || !data.user.email) { res.status(401).json({ error: "Please sign in with a confirmed email." }); return; }
      const parsed = usageRequestSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Enter a valid monthly volume, http(s) website (optional), and a use case of 10–2,000 characters." }); return; }
      if (!config.resendApiKey || !config.lineToken || !config.lineUserId) { res.status(503).json({ error: "Usage requests are temporarily unavailable. Email allen@nightlifetokyo.com." }); return; }
      const input = parsed.data;
      const payload = usagePayloads(input, data.user.email, config);
      const result = await db.rpc("submit_mcp_usage_request", { p_id: input.request_id, p_user_id: data.user.id, p_email: data.user.email, p_monthly_requests: input.monthly_requests, p_website: input.website, p_use_case: input.use_case, p_email_payload: payload.email, p_line_payload: payload.line });
      if (result.error) throw result.error;
      if (result.data === "rate_limited") { res.status(429).json({ error: "You can submit up to three usage requests per day." }); return; }
      if (result.data === "conflict") { res.status(409).json({ error: "This request was already submitted with different details. Start a new request." }); return; }
      if (result.data !== "received") throw new Error("Unexpected response");
      res.status(202).json({ request_id: input.request_id, status: "received", message: "Request received. We’ll email you about availability. Your limits and billing are unchanged." });
      void flush();
    } catch { res.status(503).json({ error: "Could not save your request. Please retry." }); }
  });
  return router;
}
