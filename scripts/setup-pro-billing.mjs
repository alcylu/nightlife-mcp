// Dry run by default. --apply prepares Stripe and configures the MCP service.
// Feed `railway variables --json` on stdin; no credentials are printed or saved.
import Stripe from "stripe";
import { spawnSync } from "node:child_process";
let input = "";
if (!process.stdin.isTTY) for await (const chunk of process.stdin) input += chunk;
const vars = input.trim() ? JSON.parse(input) : process.env;
if (!vars.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is required.");
const stripe = new Stripe(vars.STRIPE_SECRET_KEY);
const app = "nightlife-dev-pro";
const url = "https://api.nightlife.dev/billing/webhook";
const account = await stripe.accounts.retrieve();
if (!account.charges_enabled) throw new Error("Stripe account cannot accept payments.");
const [products, endpoints, portals] = await Promise.all([
  stripe.products.list({ limit: 100, active: true }),
  stripe.webhookEndpoints.list({ limit: 100 }),
  stripe.billingPortal.configurations.list({ limit: 100, active: true }),
]);
let product = products.data.find(p => p.metadata.app === app);
let portal = portals.data.find(p => p.metadata.app === app);
let endpoint = endpoints.data.find(e => e.url === url && e.status === "enabled");
let price;
if (product) {
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  price = prices.data.find(p => p.currency === "usd" && p.unit_amount === 1900 && p.recurring?.interval === "month" && p.recurring.interval_count === 1);
}
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ dry_run: true, live: vars.STRIPE_SECRET_KEY.startsWith("sk_live_"), price: "US$19/month", existing: { product: product?.id ?? null, price: price?.id ?? null, portal: portal?.id ?? null, webhook: endpoint?.id ?? null }, deployment_variables_required: ["STRIPE_PRO_PRICE_ID", "STRIPE_PRO_PORTAL_CONFIGURATION_ID", "STRIPE_PRO_WEBHOOK_SECRET", "MCP_ENABLE_MONTHLY_LIMITS=true"] }, null, 2));
  process.exit(0);
}
if (!process.env.RAILWAY_TOKEN) throw new Error("A scoped RAILWAY_TOKEN is required to save billing secrets.");
if (endpoint && !vars.STRIPE_PRO_WEBHOOK_SECRET) throw new Error("An existing webhook requires its stored signing secret. Do not create a duplicate.");
product ??= await stripe.products.create({ name: "nightlife.dev Pro", description: "Public nightlife MCP tools and REST API. 2,000 requests per billing month shared across up to 3 keys; 30 requests/minute per key.", metadata: { app } }, { idempotencyKey: "nlt-pro-product-v1" });
price ??= await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: 1900, recurring: { interval: "month" }, metadata: { app } }, { idempotencyKey: "nlt-pro-price-usd19-month-v1" });
portal ??= await stripe.billingPortal.configurations.create({
  name: "nightlife.dev Pro", metadata: { app }, default_return_url: "https://nightlife.dev/dashboard",
  business_profile: { headline: "Manage your nightlife.dev subscription", terms_of_service_url: "https://nightlife.dev/terms" },
  features: { invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: "at_period_end" }, subscription_update: { enabled: false } },
}, { idempotencyKey: "nlt-pro-portal-v1" });
endpoint ??= await stripe.webhookEndpoints.create({
  url, description: "nightlife.dev Pro billing (separate from VIP deposits)", metadata: { app },
  enabled_events: ["checkout.session.completed", "checkout.session.async_payment_succeeded", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"],
}, { idempotencyKey: "nlt-pro-webhook-v1" });
const secret = endpoint.secret || vars.STRIPE_PRO_WEBHOOK_SECRET;
if (!secret) throw new Error("Webhook signing secret unavailable; restore it from the deployment secret manager.");
const result = spawnSync("railway", ["variables", "--service", "6341504b-6b63-4dec-be75-1235563f8c36", "--environment", "production",
  "--set", `STRIPE_PRO_PRICE_ID=${price.id}`, "--set", `STRIPE_PRO_PORTAL_CONFIGURATION_ID=${portal.id}`,
  "--set", `STRIPE_PRO_WEBHOOK_SECRET=${secret}`, "--set", "DEVELOPER_SITE_URL=https://nightlife.dev",
  "--set", "MCP_ENABLE_MONTHLY_LIMITS=true", "--set", "MCP_HTTP_ALLOW_ENV_KEY_FALLBACK=false",
], { env: process.env, encoding: "utf8" });
if (result.status !== 0) throw new Error("Railway variable update failed. Keep the Stripe endpoint; rerun with its signing secret from Stripe Workbench.");
console.log(JSON.stringify({ configured: true, product: product.id, price: price.id, portal: portal.id, webhook: endpoint.id }, null, 2));
