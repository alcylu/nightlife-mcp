import { Router } from "express";
import cors from "cors";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const siteEventSchema = z.object({
  visit: z.string().uuid(),
  event: z.enum(["page_view", "plan_click", "signup_attempt", "signup_submitted", "signup_error", "email_confirmed", "checkout_attempt", "checkout_redirect", "checkout_error"]),
  page: z.enum(["home", "checkout", "signup", "login", "dashboard", "request-usage", "terms", "privacy"]),
  source: z.enum(["direct", "search", "github", "agensi", "nightlifetokyo", "other"]),
  plan: z.enum(["none", "starter", "pro"]),
}).strict();

// No auth identity or customer details are accepted. Origin and bot checks are
// abuse reduction, not proof of human traffic. Aggregate visits remain estimates.
export function createSiteAnalyticsRouter(db: SupabaseClient, siteUrl: string) {
  const router = Router();
  const origins = [siteUrl];
  const buckets = new Map<string, { count: number; until: number }>();
  let windowUntil = Date.now() + 60_000;
  let total = 0;
  router.use(cors({ origin: origins, methods: ["POST", "OPTIONS"], allowedHeaders: ["Content-Type"], maxAge: 3600 }));
  router.post("/event", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!origins.includes(req.get("origin") || "")) { res.sendStatus(403); return; }
    if (req.get("dnt") === "1" || req.get("sec-gpc") === "1" || /bot|spider|crawl|headless|curl|python|wget|undici/i.test(req.get("user-agent") || "")) { res.sendStatus(204); return; }
    const parsed = siteEventSchema.safeParse(req.body);
    if (!parsed.success) { res.sendStatus(400); return; }
    const now = Date.now();
    if (now >= windowUntil) { buckets.clear(); total = 0; windowUntil = now + 60_000; }
    // Raw IP is transient process memory only, never sent to the DB or logs.
    const key = req.ip || "unknown";
    const bucket = buckets.get(key) || { count: 0, until: windowUntil };
    if (++total > 600 || ++bucket.count > 60 || (!buckets.has(key) && buckets.size >= 1000)) { res.sendStatus(429); return; }
    buckets.set(key, bucket);
    const { visit, event, page, source, plan } = parsed.data;
    try {
      const result = await db.rpc("record_mcp_site_event", { p_visit: visit, p_event: event, p_page: page, p_source: source, p_plan: plan });
      if (result.error) throw result.error;
      res.sendStatus(204);
    } catch { res.sendStatus(503); }
  });
  return router;
}
