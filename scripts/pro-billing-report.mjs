import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const since = new Date(Date.now() - 30 * 86400000).toISOString();
async function allRows(query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await query().range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
const [accounts, funnel, siteEvents] = await Promise.all([
  allRows(() => db.from("mcp_billing_accounts").select("subscription_status,current_period_end,cancel_at_period_end,billing_plan").order("user_id")),
  allRows(() => db.from("mcp_checkout_funnel").select("source,paid_at,user_id").gte("started_at", since).order("checkout_session_id")),
  allRows(() => db.from("mcp_site_funnel_events").select("day,visit_id,event,page,source,plan").gte("day",since.slice(0,10)).order("day").order("visit_id").order("event").order("page").order("source").order("plan")),
]);
let signups = 0;
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  signups += data.users.filter(u => u.created_at >= since && u.user_metadata?.signup_app === "nightlife-dev").length;
  if (data.users.length < 1000) break;
}
const active = accounts.filter(a => a.subscription_status === "active" && Date.parse(a.current_period_end) > Date.now());
const paid = funnel.filter(c => c.paid_at);
const bySource = {};
const siteByEvent = {}, sitePages = {}, siteSources = {};
for(const row of siteEvents) {
  siteByEvent[row.event]=(siteByEvent[row.event]||0)+1;
  if(row.event==='page_view')sitePages[row.page]=(sitePages[row.page]||0)+1;
  (siteSources[row.source]??=new Set()).add(`${row.day}:${row.visit_id}`);
}
for (const checkout of funnel) {
  bySource[checkout.source] ??= { checkout_starts: 0, paid_checkouts: 0 };
  bySource[checkout.source].checkout_starts++;
  if (checkout.paid_at) bySource[checkout.source].paid_checkouts++;
}
console.log(JSON.stringify({
  window_days: 30, signups, checkout_starts: funnel.length,
  paid_checkouts: paid.length, unique_buyers: new Set(paid.map(c => c.user_id)).size,
  checkout_conversion_pct: funnel.length ? +(100 * paid.length / funnel.length).toFixed(1) : 0,
  active_starter_subscriptions: active.filter(a=>a.billing_plan==='starter').length,
  active_pro_subscriptions: active.filter(a=>a.billing_plan==='pro').length,
  scheduled_cancellations: active.filter(a => a.cancel_at_period_end).length,
  gross_usd_mrr: active.reduce((total,a)=>total+(a.billing_plan==='pro'?19:a.billing_plan==='starter'?5:0),0), by_source: bySource,
  optional_site_analytics: { started_after_deployment:true, consented_daily_tab_visits:new Set(siteEvents.filter(e=>e.event==='page_view').map(e=>`${e.day}:${e.visit_id}`)).size, events:siteByEvent, pages:sitePages, visits_by_source:Object.fromEntries(Object.entries(siteSources).map(([s,ids])=>[s,ids.size])), caveat:"Opt-in browser observations, not unique people or verified purchases; excludes known automation, may include undetected bots. Billing metrics above remain authoritative." },
}, null, 2));
