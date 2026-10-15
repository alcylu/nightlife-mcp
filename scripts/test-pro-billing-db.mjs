// Local PostgreSQL only. Everything, including temporary roles/schema, rolls back.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const url = process.env.BILLING_TEST_DATABASE_URL || "postgresql:///postgres";
const parsed = new URL(url);
if (parsed.hostname && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
  throw new Error("This regression check only runs against local PostgreSQL.");
}
const migration = ["20261015090000_mcp_pro_billing.sql", "20261015100000_mcp_monthly_allowances.sql"].map(name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8").replace(/^BEGIN;\s*/m, "").replace(/^COMMIT;\s*/m, "")).join("\n");
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
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_test','active',now()+interval '1 month',false,now(),100,now());
SELECT key_name FROM create_user_api_key('after-payment');
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE tier='starter' AND daily_quota IS NULL AND per_minute_quota=30) <> 2 THEN
    RAISE EXCEPTION 'Existing/new key upgrade failed';
  END IF;
  IF has_table_privilege('authenticated','public.mcp_api_keys','UPDATE') OR has_table_privilege('anon','public.mcp_billing_accounts','SELECT') OR has_function_privilege('authenticated','sync_mcp_subscription(uuid,text,text,text,timestamptz,boolean,timestamptz,bigint,timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION 'Billing permissions allow unauthorized writes/reads';
  END IF;
END $$;
-- A stale observation must not overwrite newer access.
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_test','canceled',now(),false,now()-interval '1 hour',100,now());
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE tier='starter') <> 2 THEN RAISE EXCEPTION 'Stale event overwrote access'; END IF;
END $$;
-- Cancel at period end retains access; expiration / failed payment removes it.
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_test','active',now()+interval '1 day',true,now(),100,now());
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE tier='starter') <> 2 THEN RAISE EXCEPTION 'Scheduled cancellation removed access early'; END IF;
END $$;
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_test','past_due',now()+interval '1 day',false,now(),100,now());
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE tier='free' AND daily_quota IS NULL AND per_minute_quota=5) <> 2 THEN RAISE EXCEPTION 'Failed payment downgrade failed'; END IF;
END $$;
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_new','active',now()+interval '1 month',false,now(),200,now());
SELECT sync_mcp_subscription(auth.uid(),'cus_test','sub_test','canceled',now(),false,now(),100,now());
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE tier='starter') <> 2 THEN RAISE EXCEPTION 'Old cancelled subscription overwrote resubscription'; END IF;
END $$;
-- A shared allowance cannot be multiplied by creating or switching keys.
INSERT INTO mcp_api_usage_monthly(user_id,period_start,request_count) VALUES(auth.uid(),now(),1999);
SELECT allowed FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys LIMIT 1),now(),true);
DO $$ DECLARE result record; BEGIN
  SELECT * INTO result FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys ORDER BY key_name DESC LIMIT 1),now(),true);
  IF result.allowed OR result.reason<>'monthly_limit_exceeded' THEN RAISE EXCEPTION 'Shared monthly quota not enforced'; END IF;
  SELECT * INTO result FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys LIMIT 1),now(),false);
  IF NOT result.allowed OR result.monthly_count<>2000 THEN RAISE EXCEPTION 'Control traffic charged or blocked at cap'; END IF;
END $$;
-- A new billing period has a fresh allowance, including across calendar months.
DO $$ DECLARE result record; BEGIN
  SELECT * INTO result FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys LIMIT 1),now()+interval '2 months',true);
  IF NOT result.allowed OR result.monthly_quota<>100 OR result.monthly_count<>1 THEN RAISE EXCEPTION 'Free period reset / paid expiration failed'; END IF;
END $$;
SELECT revoke_user_api_key((SELECT id FROM mcp_api_keys LIMIT 1));
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_api_keys WHERE status='revoked') <> 1 THEN RAISE EXCEPTION 'Existing revocation RPC broken'; END IF;
END $$;
-- Free accounts share 100 total even after switching/recreating keys.
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000002');
SELECT set_config('test.user_id','00000000-0000-4000-8000-000000000002',true);
SELECT key_name FROM create_user_api_key('free-a');
SELECT key_name FROM create_user_api_key('free-b');
INSERT INTO mcp_api_usage_monthly(user_id,period_start,request_count)
  SELECT auth.uid(),period_start,99 FROM mcp_monthly_window(auth.uid(),now());
DO $$ DECLARE result record; BEGIN
  SELECT * INTO result FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys WHERE key_name='free-a'),now(),true);
  IF NOT result.allowed OR result.monthly_count<>100 THEN RAISE EXCEPTION 'Free 100th request failed'; END IF;
  SELECT * INTO result FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys WHERE key_name='free-b'),now(),true);
  IF result.allowed OR result.reason<>'monthly_limit_exceeded' THEN RAISE EXCEPTION 'Free 101st request not blocked'; END IF;
  SELECT * INTO result FROM get_user_monthly_usage();
  IF result.monthly_count<>100 OR result.monthly_quota<>100 THEN RAISE EXCEPTION 'Dashboard allowance mismatch'; END IF;
END $$;
INSERT INTO mcp_api_keys(key_name,key_hash,key_prefix,daily_quota,per_minute_quota) VALUES('internal','internal-hash','internal',500,30);
DO $$ DECLARE result record; BEGIN
  SELECT * INTO result FROM consume_mcp_api_request_v2('internal-hash',now(),true);
  IF NOT result.allowed OR result.daily_quota<>500 OR result.monthly_quota IS NOT NULL THEN RAISE EXCEPTION 'Internal key contract changed'; END IF;
END $$;
ROLLBACK;
`;
const result = spawnSync("psql", [url, "-X", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, encoding: "utf8" });
if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
console.log("Billing migrations passed: paid/free shared monthly caps, resets, unmetered controls, dashboard counts, internal keys, upgrade/downgrade, permissions and revocation. All local changes rolled back.");
