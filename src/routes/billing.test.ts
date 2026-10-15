import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBillingRouter } from "./billing.js";

test("billing routes reject API keys, unconfirmed users, and forged webhooks", async () => {
  const stripe = new Stripe("sk_test_fixture");
  const db = { auth: { async getUser() { return { data: { user: { id: "user", email_confirmed_at: null } }, error: null }; } } } as unknown as SupabaseClient;
  const app = express();
  app.use("/billing/webhook", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use("/billing", createBillingRouter(db, stripe, { priceId: "price_pro", portalConfigurationId: "bpc_test", siteUrl: "https://nightlife.dev" }, "whsec_fixture"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/billing`;
  try {
    assert.equal((await fetch(`${base}/checkout`, { method: "POST", headers: { "x-api-key": "ops-key" } })).status, 401);
    assert.equal((await fetch(`${base}/status`, { headers: { Authorization: "Bearer unconfirmed" } })).status, 401);
    assert.equal((await fetch(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "forged" }, body: "{}" })).status, 400);
    const body = JSON.stringify({ id: "evt_test", type: "customer.subscription.updated", data: { object: { id: "sub_test" } } });
    stripe.subscriptions.retrieve = (async () => { throw new Error("Database or Stripe unavailable"); }) as any;
    const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_fixture" });
    const response = await fetch(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": signature }, body });
    assert.equal(response.status, 500, "failed webhooks must be retried by Stripe");
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
