// Local PostgreSQL only. Everything, including temporary roles/schema, rolls back.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const url = process.env.BILLING_TEST_DATABASE_URL || "postgresql:///postgres";
const parsed = new URL(url);
if (parsed.hostname && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
  throw new Error("This regression check only runs against local PostgreSQL.");
}
const migration = readFileSync(new URL("../supabase/migrations/20261015090000_mcp_pro_billing.sql", import.meta.url), "utf8").replace(/^BEGIN;\s*/m, "").replace(/^COMMIT;\s*/m, "");
const initial = ["20260219094000_mcp_api_keys.sql", "20260220_user_api_keys.sql"].map(name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")).join("\n");
const sql = `
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth') OR to_regclass('public.mcp_api_keys') IS NOT NULL THEN
    RAISE EXCEPTION 'Use an empty local database for this check';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.user_id',true),'')::uuid $$;
${initial}
${migration}
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001');
SELECT set_config('test.user_id','00000000-0000-4000-8000-000000000001',true);
SELECT key_name FROM create_user_api_key('before-payment');
INSERT INTO mcp_billing_accounts(user_id,stripe_customer_id) VALUES(auth.uid(),'cus_test');
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_test','active',now()+interval '1 month',false,now(),100);
SELECT key_name FROM create_user_api_key('after-payment');
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE tier='starter' AND daily_quota=1000 AND per_minute_quota=60) <> 2 THEN
    RAISE EXCEPTION 'Existing/new key upgrade failed';
  END IF;
  IF has_table_privilege('authenticated','public.mcp_api_keys','UPDATE') OR has_table_privilege('anon','public.mcp_billing_accounts','SELECT') OR has_function_privilege('authenticated','sync_mcp_subscription(uuid,text,text,text,timestamptz,boolean,timestamptz,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'Billing permissions allow unauthorized writes/reads';
  END IF;
END $$;
-- A stale observation must not overwrite newer access.
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_test','canceled',now(),false,now()-interval '1 hour',100);
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE tier='starter') <> 2 THEN RAISE EXCEPTION 'Stale event overwrote access'; END IF;
END $$;
-- Cancel at period end retains access; expiration / failed payment removes it.
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_test','active',now()+interval '1 day',true,now(),100);
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE tier='starter') <> 2 THEN RAISE EXCEPTION 'Scheduled cancellation removed access early'; END IF;
END $$;
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_test','past_due',now()+interval '1 day',false,now(),100);
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE tier='free' AND daily_quota=100 AND per_minute_quota=20) <> 2 THEN RAISE EXCEPTION 'Failed payment downgrade failed'; END IF;
END $$;
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_new','active',now()+interval '1 month',false,now(),200);
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_test','canceled',now(),false,now(),100);
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE tier='starter') <> 2 THEN RAISE EXCEPTION 'Old cancelled subscription overwrote resubscription'; END IF;
END $$;
SELECT revoke_user_api_key((SELECT id FROM mcp_api_keys LIMIT 1));
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE status='revoked') <> 1 THEN RAISE EXCEPTION 'Existing revocation RPC broken'; END IF;
END $$;
ROLLBACK;
`;
const result = spawnSync("psql", [url, "-X", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, encoding: "utf8" });
if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
console.log("Billing migration passed: upgrade, new keys, permissions, stale updates, cancellation, downgrade, revocation. All local changes rolled back.");
