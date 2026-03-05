import { Router } from "express";
import type { Request, Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe, constructWebhookEvent } from "../services/stripe.js";
import { handleCheckoutCompleted, handleCheckoutExpired } from "../services/deposits.js";
import { logEvent } from "../observability/metrics.js";

export function createStripeWebhookRouter(
  supabase: SupabaseClient,
  stripeSecretKey: string,
  webhookSecret: string,
  resendApiKey: string | null,
): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      res.status(400).json({ error: "Missing stripe-signature header." });
      return;
    }

    let event;
    try {
      const stripe = getStripe(stripeSecretKey);
      event = constructWebhookEvent(stripe, req.body as Buffer, signature, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logEvent("stripe.webhook.verification_failed", { error: message });
      res.status(400).json({ error: "Webhook signature verification failed." });
      return;
    }

    logEvent("stripe.webhook.received", {
      type: event.type,
      id: event.id,
    });

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          await handleCheckoutCompleted(supabase, session, { resendApiKey: resendApiKey ?? undefined });
          break;
        }
        case "checkout.session.expired": {
          const session = event.data.object;
          await handleCheckoutExpired(supabase, session, { resendApiKey: resendApiKey ?? undefined });
          break;
        }
        default:
          logEvent("stripe.webhook.unhandled", { type: event.type });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logEvent("stripe.webhook.handler_error", {
        type: event.type,
        error: message,
      });
    }

    // Always return 200 to prevent Stripe retries
    res.status(200).json({ received: true });
  });

  return router;
}
