import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBillingRouter } from "./billing.js";

test("billing advertises only paid plans and rejects missing or invented checkout plans", async () => {
  const stripe = new Stripe("sk_test_fixture");
  stripe.prices.retrieve = (async (id: string) => ({id, active:true, currency:"usd", unit_amount:id==="price_starter"?500:1900, recurring:{interval:"month",interval_count:1},type:"recurring"})) as any;
  const db = {auth:{async getUser(){return {data:{user:{id:"user",email_confirmed_at:"2026-10-15"}},error:null};}}} as unknown as SupabaseClient;
  const app=express(); app.use(express.json());
  app.use("/billing",createBillingRouter(db,stripe,{priceId:"price_pro",starterPriceId:"price_starter",portalConfigurationId:"bpc",siteUrl:"https://nightlife.dev"},"secret"));
  const server=app.listen(0,"127.0.0.1"); await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/billing`;
  try {
    const config=await (await fetch(`${base}/config`)).json() as any;
    assert.equal(config.free_available,false);
    assert.deepEqual(Object.keys(config.plans),["starter","pro"]);
    assert.equal(config.plans.starter.amount,500);assert.equal(config.plans.starter.monthly_quota,500);
    assert.equal(config.plans.pro.amount,1900);assert.equal(config.plans.pro.monthly_quota,5000);
    for(const body of [{},{plan:"free"},{plan:"enterprise"}]) assert.equal((await fetch(`${base}/checkout`,{method:"POST",headers:{Authorization:"Bearer fixture","Content-Type":"application/json"},body:JSON.stringify(body)})).status,400);
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
});

test("billing routes reject API keys, unconfirmed users, and forged webhooks", async () => {
  const stripe = new Stripe("sk_test_fixture");
  const db = { auth: { async getUser() { return { data: { user: { id: "user", email_confirmed_at: null } }, error: null }; } } } as unknown as SupabaseClient;
  const app = express();
  app.use("/billing/webhook", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use("/billing", createBillingRouter(db, stripe, { priceId: "price_pro", starterPriceId:"price_starter", portalConfigurationId: "bpc_test", siteUrl: "https://nightlife.dev" }, "whsec_fixture"));
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
