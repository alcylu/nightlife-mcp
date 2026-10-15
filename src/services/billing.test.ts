import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { BILLING_APP, cleanCheckoutSource, hasProAccess, processBillingEvent, startCheckout, syncSubscription, validateProPrice } from "./billing.js";

const user = { id: "00000000-0000-4000-8000-000000000001", email: "test@example.com" } as User;
const settings = { priceId: "price_pro", starterPriceId:"price_starter", portalConfigurationId: "bpc_test", siteUrl: "https://nightlife.dev" };

function fixtures() {
  const state: any = { account: null, funnel: {}, customerCalls: [], checkoutCalls: [], syncCalls: [], sessions: {}, subscription: {
    id: "sub_pro", created: 1700000000, customer: "cus_pro", metadata: { app: BILLING_APP, user_id: user.id }, status: "active", cancel_at_period_end: false, latest_invoice:{status:"paid"},
    items: { data: [{ quantity:1,price: { id: settings.priceId }, current_period_start: Math.floor(Date.now() / 1000), current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
  }};
  const db = {
    from(table: string) {
      let op = "select"; let payload: any; const filters: any = {};
      const q: any = {
        select() { return q; }, eq(k: string, v: any) { filters[k] = v; return q; },
        is(k: string, v: any) { filters[k] = v; return q; },
        upsert(v: any) { op = "upsert"; payload = v; return q; },
        update(v: any) { op = "update"; payload = v; return q; },
        maybeSingle() { return q; },
        then(resolve: any) {
          if (table === "mcp_billing_accounts") {
            if (op === "upsert" && !state.account) state.account = { ...payload, checkout_attempt: "attempt-stable", subscription_status: "none" };
            if (op === "update" && (!filters.checkout_session_id || filters.checkout_session_id === state.account.checkout_session_id)) Object.assign(state.account, payload);
            resolve({ data: state.account ? { ...state.account } : null, error: null });
          } else {
            if (op === "upsert" && !state.funnel[payload.checkout_session_id]) state.funnel[payload.checkout_session_id] = { ...payload };
            if (op === "update" && state.funnel[filters.checkout_session_id] && !state.funnel[filters.checkout_session_id].paid_at) Object.assign(state.funnel[filters.checkout_session_id], payload);
            resolve({ data: null, error: null });
          }
        },
      }; return q;
    },
    async rpc(name: string, args: any) {
      if(name==='claim_mcp_checkout'){ if(state.locked)return{data:null,error:null};state.locked=true;return{data:'lock-1',error:null}; }
      if(name==='release_mcp_checkout'){state.locked=false;return{error:null};}
      state.syncCalls.push(args); return { error: null };
    },
  } as unknown as SupabaseClient;
  const stripe = {
    prices: { async retrieve(id:string) { return { id, active: true, currency: "usd", unit_amount: id==='price_starter'?500:1900, type: "recurring", recurring: { interval: "month", interval_count: 1 } }; } },
    customers: { async create(args: any, options: any) { state.customerCalls.push({ args, options }); return { id: "cus_pro" }; } },
    subscriptions: { async retrieve() { return state.subscription; } },
    checkout: { sessions: {
      async create(args: any, options: any) {
        state.checkoutCalls.push({ args, options });
        const session = { id: args.metadata.plan==='starter'?'cs_starter':'cs_pro', url: "https://checkout.stripe.com/c/pay/test", status: "open", metadata: args.metadata };
        state.sessions[session.id] = session; return session;
      },
      async retrieve(id: string) { return state.sessions[id]; },
      async expire(id:string){state.sessions[id].status='expired';return state.sessions[id];},
    } },
  } as unknown as Stripe;
  return { state, db, stripe };
}

test("Pro requires active status and a future paid period", () => {
  assert.equal(hasProAccess("active", new Date(Date.now() + 10000).toISOString()), true);
  for (const status of ["past_due", "trialing", "unpaid", "canceled", "incomplete", "paused"]) assert.equal(hasProAccess(status, "2099-01-01"), false);
  assert.equal(hasProAccess("active", "2020-01-01"), false);
  assert.equal(hasProAccess("active", null), false);
});

test("checkout source is bounded and does not accept arbitrary personal data", () => {
  assert.equal(cleanCheckoutSource("pricing"), "pricing");
  assert.equal(cleanCheckoutSource("email@example.com"), "direct");
  assert.equal(cleanCheckoutSource("a".repeat(51)), "direct");
});

test("configured Pro price must match the advertised monthly USD price", async () => {
  const { stripe } = fixtures();
  await validateProPrice(stripe, settings.priceId);
  stripe.prices.retrieve = (async () => ({ active: true, currency: "usd", unit_amount: 9900, recurring: { interval: "month" } })) as any;
  await assert.rejects(validateProPrice(stripe, settings.priceId), /unavailable/);
});

test("checkout fixes the price and account on the server and reuses open sessions", async () => {
  const { state, db, stripe } = fixtures();
  const url = await startCheckout(db, stripe, settings, user, "pricing");
  assert.match(url, /^https:\/\/checkout.stripe.com\//);
  assert.equal(state.checkoutCalls[0].args.mode, "subscription");
  assert.equal(state.checkoutCalls[0].args.client_reference_id, user.id);
  assert.deepEqual(state.checkoutCalls[0].args.line_items, [{ price: "price_pro", quantity: 1 }]);
  assert.equal(state.checkoutCalls[0].args.subscription_data.metadata.user_id, user.id);
  assert.equal(state.checkoutCalls[0].options.idempotencyKey, "nlt-checkout-attempt-stable-pro");
  assert.equal(state.funnel.cs_pro.source, "pricing");
  await startCheckout(db, stripe, settings, user, "direct");
  assert.equal(state.checkoutCalls.length, 1);
  assert.equal(state.customerCalls.length, 1);
});

test("a failed database write can retry without creating a second Stripe session", async () => {
  const { state, db, stripe } = fixtures();
  await startCheckout(db, stripe, settings, user, "direct");
  state.account.checkout_session_id = null; // crash between Stripe create and persistence
  await startCheckout(db, stripe, settings, user, "direct");
  assert.equal(state.checkoutCalls[0].options.idempotencyKey, state.checkoutCalls[1].options.idempotencyKey);
});

test("existing subscriptions must use billing management, preventing duplicate charges", async () => {
  const { state, db, stripe } = fixtures();
  state.account = { user_id: user.id, subscription_status: "past_due", stripe_customer_id: "cus_pro" };
  await assert.rejects(startCheckout(db, stripe, settings, user, "direct"), /already have a subscription/);
  assert.equal(state.checkoutCalls.length, 0);
});

test("subscription webhooks reconcile current Stripe state, including cancellation", async () => {
  const { state, db, stripe } = fixtures();
  state.subscription.cancel_at_period_end = true;
  await syncSubscription(db, stripe, settings, "sub_pro");
  assert.equal(state.syncCalls[0].p_status, "active");
  assert.equal(state.syncCalls[0].p_cancel_at_period_end, true);
  state.subscription.status = "canceled";
  await syncSubscription(db, stripe, settings, "sub_pro");
  assert.equal(state.syncCalls[1].p_status, "canceled");
  state.subscription.metadata.app = "vip-deposits";
  await syncSubscription(db, stripe, settings, "sub_pro");
  assert.equal(state.syncCalls.length, 2);
});

test("an unpaid checkout is never counted as a paid conversion; duplicates stay one", async () => {
  const { state, db, stripe } = fixtures();
  await startCheckout(db, stripe, settings, user, "direct");
  const session = state.sessions.cs_pro;
  const event = { type: "checkout.session.completed", data: { object: session } } as Stripe.Event;
  await processBillingEvent(db, stripe, settings, event);
  assert.equal(state.funnel.cs_pro.paid_at, undefined);
  Object.assign(session, { subscription: "sub_pro", payment_status: "paid", amount_total: 1900, currency: "usd" });
  await processBillingEvent(db, stripe, settings, event);
  const paidAt = state.funnel.cs_pro.paid_at;
  await processBillingEvent(db, stripe, settings, event);
  assert.equal(state.funnel.cs_pro.paid_at, paidAt);
  assert.equal(state.funnel.cs_pro.amount_total, 1900);
});

test("invoice failures refresh the subscription using current invoice parent linkage", async () => {
  const { state, db, stripe } = fixtures();
  state.subscription.status = "past_due";
  await processBillingEvent(db, stripe, settings, {
    type: "invoice.payment_failed", data: { object: { parent: { subscription_details: { subscription: "sub_pro" } } } },
  } as Stripe.Event);
  assert.equal(state.syncCalls[0].p_status, "past_due");
});

test("Starter checkout fixes the US$5 price and switching plans expires the old checkout",async()=>{
  const {state,db,stripe}=fixtures();
  await startCheckout(db,stripe,settings,user,'pricing','pro');
  await startCheckout(db,stripe,settings,user,'pricing','starter');
  assert.equal(state.sessions.cs_pro.status,'expired');
  assert.deepEqual(state.checkoutCalls[1].args.line_items,[{price:'price_starter',quantity:1}]);
  assert.equal(state.checkoutCalls[1].args.metadata.plan,'starter');
  assert.match(state.checkoutCalls[1].args.cancel_url,/plan=starter/);
  assert.notEqual(state.checkoutCalls[0].options.idempotencyKey,state.checkoutCalls[1].options.idempotencyKey);
  await startCheckout(db,stripe,settings,user,'pricing','starter');
  assert.equal(state.checkoutCalls.length,2);
});

test("simultaneous different-plan checkout requests cannot create duplicate subscriptions",async()=>{
  const {state,db,stripe}=fixtures();state.locked=true;
  await assert.rejects(startCheckout(db,stripe,settings,user,'pricing','starter'),/already being prepared/);
  assert.equal(state.checkoutCalls.length,0);
});

test("subscription access follows recognized price and paid invoice, never client plan metadata",async()=>{
  const {state,db,stripe}=fixtures();
  state.subscription.metadata.plan='pro';state.subscription.items.data[0].price.id='price_starter';
  await syncSubscription(db,stripe,settings,'sub_pro');assert.equal(state.syncCalls[0].p_plan,'starter');assert.equal(state.syncCalls[0].p_status,'active');
  state.subscription.items.data[0].price.id='price_pro';state.subscription.latest_invoice.status='open';
  await syncSubscription(db,stripe,settings,'sub_pro');assert.equal(state.syncCalls[1].p_status,'paused');
  state.subscription.latest_invoice.status='paid';await syncSubscription(db,stripe,settings,'sub_pro');assert.equal(state.syncCalls[2].p_plan,'pro');assert.equal(state.syncCalls[2].p_status,'active');
  state.subscription.items.data[0].price.id='unrecognized';await syncSubscription(db,stripe,settings,'sub_pro');assert.equal(state.syncCalls[3].p_plan,'none');assert.equal(state.syncCalls[3].p_status,'paused');
});
