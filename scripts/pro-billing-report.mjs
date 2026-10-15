import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const since = new Date(Date.now() - 30 * 86400000).toISOString();
const [accounts, funnel] = await Promise.all([
  db.from("mcp_billing_accounts").select("subscription_status,current_period_end,cancel_at_period_end"),
  db.from("mcp_checkout_funnel").select("source,paid_at,user_id").gte("started_at", since),
]);
for (const response of [accounts, funnel]) if (response.error) throw response.error;
let signups = 0;
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  signups += data.users.filter(u => u.created_at >= since && u.user_metadata?.signup_app === "nightlife-dev").length;
  if (data.users.length < 1000) break;
}
const active = accounts.data.filter(a => a.subscription_status === "active" && Date.parse(a.current_period_end) > Date.now());
const paid = funnel.data.filter(c => c.paid_at);
const bySource = {};
for (const checkout of funnel.data) {
  bySource[checkout.source] ??= { checkout_starts: 0, paid_checkouts: 0 };
  bySource[checkout.source].checkout_starts++;
  if (checkout.paid_at) bySource[checkout.source].paid_checkouts++;
}
console.log(JSON.stringify({
  window_days: 30, signups, checkout_starts: funnel.data.length,
  paid_checkouts: paid.length, unique_buyers: new Set(paid.map(c => c.user_id)).size,
  checkout_conversion_pct: funnel.data.length ? +(100 * paid.length / funnel.data.length).toFixed(1) : 0,
  active_pro_subscriptions: active.length,
  scheduled_cancellations: active.filter(a => a.cancel_at_period_end).length,
  gross_usd_mrr: active.length * 29, by_source: bySource,
}, null, 2));
