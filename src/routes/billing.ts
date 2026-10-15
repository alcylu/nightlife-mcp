import { Router } from "express";
import type { Request, Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  BillingError, getAccount, hasProAccess, processBillingEvent, reconcileAccount,
  startCheckout, validateProPrice, type BillingSettings,
} from "../services/billing.js";
import { paidPlans, parsePaidPlan } from "../services/plans.js";
import { logEvent } from "../observability/metrics.js";

export function createBillingRouter(
  db: SupabaseClient, stripe: Stripe | null, settings: BillingSettings | null,
  webhookSecret: string | null,
): Router {
  const router = Router();
  const attempts = new Map<string, { count: number; resetAt: number }>();

  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.get("/config", async (_req, res) => {
    if (!stripe || !settings || !webhookSecret) { res.json({ enabled: false }); return; }
    try {
      await Promise.all([validateProPrice(stripe, settings.priceId),validateProPrice(stripe, settings.starterPriceId,"starter")]);
      res.json({ enabled: true, plans: paidPlans, interval: "month", free_available: false });
    } catch { res.status(503).json({ enabled: false, error: "Checkout is temporarily unavailable." }); }
  });

  // This webhook is independent of VIP deposits and returns 500 on processing
  // errors so Stripe retries failed entitlement updates.
  router.post("/webhook", async (req, res) => {
    if (!stripe || !settings || !webhookSecret) { res.sendStatus(503); return; }
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) { res.sendStatus(400); return; }
    let event: Stripe.Event;
    try { event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret); }
    catch { res.status(400).json({ error: "Invalid webhook signature." }); return; }
    try {
      await processBillingEvent(db, stripe, settings, event);
      res.json({ received: true });
    } catch (error) {
      logEvent("billing.webhook.failed", { event_id: event.id, type: event.type });
      res.status(500).json({ error: "Billing update failed; retry required." });
    }
  });

  router.use(async (req, res, next) => {
    if (!stripe || !settings || !webhookSecret) { res.status(503).json({ error: "Checkout is not available yet." }); return; }
    const token = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!token) { res.status(401).json({ error: "Please sign in to continue." }); return; }
    try {
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user?.email_confirmed_at) { res.status(401).json({ error: "Please sign in with a confirmed email." }); return; }
      res.locals.billingUser = data.user;
      if (req.method === "POST") {
        const now = Date.now();
        // Bound the cache to prevent retaining dormant account IDs indefinitely.
        for (const [id, entry] of attempts) if (entry.resetAt <= now) attempts.delete(id);
        const entry = attempts.get(data.user.id) ?? { count: 0, resetAt: now + 300_000 };
        if (++entry.count > 10) { res.status(429).json({ error: "Please wait a few minutes before trying again." }); return; }
        attempts.set(data.user.id, entry);
      }
      next();
    } catch { res.status(503).json({ error: "Sign-in verification is temporarily unavailable." }); }
  });

  function handler(fn: (req: Request, res: Response) => Promise<void>) {
    return async (req: Request, res: Response) => {
      try { await fn(req, res); }
      catch (error) {
        const status = error instanceof BillingError ? error.status : 503;
        res.status(status).json({ error: error instanceof BillingError ? error.message : "Billing is temporarily unavailable. Please retry." });
        logEvent("billing.request.failed", { path: req.path, status });
      }
    };
  }

  router.get("/status", handler(async (_req, res) => {
    const account = await reconcileAccount(db, stripe!, settings!, res.locals.billingUser.id);
    const active = !!account && hasProAccess(account.subscription_status, account.current_period_end) && !!account.current_period_start && Date.parse(account.current_period_start)<=Date.now() && account.billing_plan !== "none";
    const plan = active ? account!.billing_plan : "none";
    res.json({
      plan, status: account?.subscription_status ?? "none",
      current_period_end: account?.current_period_end ?? null,
      cancel_at_period_end: account?.cancel_at_period_end ?? false,
      can_manage: !!account?.stripe_customer_id && !!account?.stripe_subscription_id,
      monthly_quota: plan === "none" ? 0 : paidPlans[plan].monthly_quota, per_minute_quota: plan === "none" ? 0 : paidPlans[plan].per_minute_quota,
      advanced_data: active,
    });
  }));
  router.post("/checkout", handler(async (req, res) => {
    let plan;
    try { plan = parsePaidPlan(req.body?.plan); } catch { throw new BillingError(400,"Select Starter or Pro."); }
    res.json({ url: await startCheckout(db, stripe!, settings!, res.locals.billingUser, req.body?.source, plan) });
  }));
  router.post("/portal", handler(async (_req, res) => {
    const account = await getAccount(db, res.locals.billingUser.id);
    if (!account?.stripe_customer_id || !account.stripe_subscription_id) throw new BillingError(409, "No subscription to manage.");
    const session = await stripe!.billingPortal.sessions.create({
      customer: account.stripe_customer_id, configuration: settings!.portalConfigurationId,
      return_url: `${settings!.siteUrl}/dashboard`,
    });
    res.json({ url: session.url });
  }));
  return router;
}
