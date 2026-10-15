import { randomUUID } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type Stripe from "stripe";

export const BILLING_APP = "nightlife-dev-pro";
export const BILLING_EVENTS = [
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "customer.subscription.created", "customer.subscription.updated",
  "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed",
] as const;

export type BillingSettings = {
  priceId: string;
  portalConfigurationId: string;
  siteUrl: string;
};

type Account = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  checkout_attempt: string;
  checkout_session_id: string | null;
};

export class BillingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function objectId(value: string | { id: string } | null): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

export function hasProAccess(status: string, periodEnd: string | null, now = Date.now()): boolean {
  return status === "active" && !!periodEnd && Date.parse(periodEnd) > now;
}

export function cleanCheckoutSource(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,50}$/.test(value) ? value : "direct";
}

export async function getAccount(db: SupabaseClient, userId: string): Promise<Account | null> {
  const { data, error } = await db.from("mcp_billing_accounts").select("*").eq("user_id", userId).maybeSingle();
  check(error);
  return data as Account | null;
}

export async function validateProPrice(stripe: Stripe, priceId: string): Promise<Stripe.Price> {
  const price = await stripe.prices.retrieve(priceId);
  if (!price.active || price.currency !== "usd" || price.unit_amount !== 2900 ||
      price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 ||
      price.type !== "recurring") {
    throw new BillingError(503, "Pro checkout is temporarily unavailable.");
  }
  return price;
}

export async function syncSubscription(
  db: SupabaseClient, stripe: Stripe, settings: BillingSettings, subscriptionId: string,
): Promise<void> {
  // Retrieve current state: webhook delivery order is not guaranteed.
  const syncedAt = new Date().toISOString();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (sub.metadata.app !== BILLING_APP) return;
  const userId = sub.metadata.user_id;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Subscription has no valid account owner.");
  const item = sub.items.data.find(i => i.price.id === settings.priceId);
  const periodEnd = item?.current_period_end;
  const { error } = await db.rpc("sync_mcp_subscription", {
    p_user_id: userId, p_customer_id: objectId(sub.customer), p_subscription_id: sub.id,
    p_status: item && !sub.pause_collection ? sub.status : "paused",
    p_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    p_cancel_at_period_end: sub.cancel_at_period_end, p_synced_at: syncedAt,
    p_subscription_created_at: sub.created,
  });
  check(error);
}

export async function recordPaidCheckout(db: SupabaseClient, session: Stripe.Checkout.Session): Promise<void> {
  if (session.metadata?.app !== BILLING_APP || session.payment_status !== "paid") return;
  const { error } = await db.from("mcp_checkout_funnel").update({
    paid_at: new Date().toISOString(), amount_total: session.amount_total, currency: session.currency,
  }).eq("checkout_session_id", session.id).is("paid_at", null);
  check(error);
}

export async function reconcileAccount(db: SupabaseClient, stripe: Stripe, settings: BillingSettings, userId: string): Promise<Account | null> {
  let account = await getAccount(db, userId);
  if (!account) return null;
  if (account.checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(account.checkout_session_id);
    if (session.status === "complete" && objectId(session.subscription)) {
      await syncSubscription(db, stripe, settings, objectId(session.subscription)!);
      await recordPaidCheckout(db, session);
    }
  }
  account = await getAccount(db, userId);
  if (account?.stripe_subscription_id) {
    await syncSubscription(db, stripe, settings, account.stripe_subscription_id);
    account = await getAccount(db, userId);
  }
  return account;
}

export async function startCheckout(db: SupabaseClient, stripe: Stripe, settings: BillingSettings, user: User, source: unknown): Promise<string> {
  await validateProPrice(stripe, settings.priceId);
  let account = await reconcileAccount(db, stripe, settings, user.id);
  if (account && ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"].includes(account.subscription_status)) {
    throw new BillingError(409, "You already have a subscription. Manage it from your dashboard.");
  }
  if (!account) {
    const { error } = await db.from("mcp_billing_accounts").upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
    check(error);
    account = await getAccount(db, user.id);
  }
  if (!account) throw new Error("Could not initialize billing account.");
  if (account.checkout_session_id) {
    const previous = await stripe.checkout.sessions.retrieve(account.checkout_session_id);
    if (previous.status === "open" && previous.url) return previous.url;
    const { error } = await db.from("mcp_billing_accounts").update({
      checkout_attempt: randomUUID(), checkout_session_id: null,
    }).eq("user_id", user.id).eq("checkout_session_id", previous.id);
    check(error);
    account = (await getAccount(db, user.id))!;
  }
  if (!account.stripe_customer_id) {
    const customer = await stripe.customers.create({
      email: user.email, metadata: { app: BILLING_APP, user_id: user.id },
    }, { idempotencyKey: `nlt-pro-customer-${user.id}` });
    const { error } = await db.from("mcp_billing_accounts").update({ stripe_customer_id: customer.id }).eq("user_id", user.id);
    check(error);
    account.stripe_customer_id = customer.id;
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription", customer: account.stripe_customer_id,
    client_reference_id: user.id, line_items: [{ price: settings.priceId, quantity: 1 }],
    payment_method_types: ["card"],
    metadata: { app: BILLING_APP, user_id: user.id },
    subscription_data: { metadata: { app: BILLING_APP, user_id: user.id } },
    success_url: `${settings.siteUrl}/checkout?result=success`,
    cancel_url: `${settings.siteUrl}/checkout?result=cancelled`,
  }, { idempotencyKey: `nlt-pro-checkout-${account.checkout_attempt}` });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  const { error } = await db.from("mcp_billing_accounts").update({ checkout_session_id: session.id }).eq("user_id", user.id);
  check(error);
  const { error: funnelError } = await db.from("mcp_checkout_funnel").upsert({
    checkout_session_id: session.id, user_id: user.id, source: cleanCheckoutSource(source),
  }, { onConflict: "checkout_session_id", ignoreDuplicates: true });
  check(funnelError);
  return session.url;
}

export async function processBillingEvent(db: SupabaseClient, stripe: Stripe, settings: BillingSettings, event: Stripe.Event): Promise<void> {
  if (event.type.startsWith("customer.subscription.")) {
    await syncSubscription(db, stripe, settings, (event.data.object as Stripe.Subscription).id);
  } else if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.app !== BILLING_APP) return;
    const subId = objectId(session.subscription);
    if (subId) await syncSubscription(db, stripe, settings, subId);
    await recordPaidCheckout(db, session);
  } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = objectId(invoice.parent?.subscription_details?.subscription ?? null);
    if (subId) await syncSubscription(db, stripe, settings, subId);
  }
}
