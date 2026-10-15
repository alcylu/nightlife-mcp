// Local PostgreSQL only. Everything, including temporary roles/schema, rolls back.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const url = process.env.BILLING_TEST_DATABASE_URL || "postgresql:///postgres";
const parsed = new URL(url);
if (parsed.hostname && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
  throw new Error("This regression check only runs against local PostgreSQL.");
}
const migration = ["20261015090000_mcp_pro_billing.sql", "20261015100000_mcp_monthly_allowances.sql", "20261015120000_mcp_usage_requests.sql"].map(name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8").replace(/^BEGIN;\s*/m, "").replace(/^COMMIT;\s*/m, "")).join("\n");
const initial = ["20260219094000_mcp_api_keys.sql", "20260220_user_api_keys.sql"].map(name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")).join("\n");
const paidMigration=['20261015140000_mcp_paid_plans.sql','20261015150000_mcp_private_legacy_metering.sql'].map(name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8').replace(/^BEGIN;\s*/m,'').replace(/^COMMIT;\s*/m,'')).join('\n');
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
DO $$ DECLARE result text; claimed integer; BEGIN
  IF has_table_privilege('authenticated','mcp_usage_requests','SELECT') OR has_table_privilege('anon','mcp_usage_notifications','INSERT') OR has_function_privilege('authenticated','claim_mcp_usage_notifications()','EXECUTE') OR has_function_privilege('authenticated','submit_mcp_usage_request(uuid,uuid,text,integer,text,text,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Usage queue permissions unsafe'; END IF;
  result := submit_mcp_usage_request('00000000-0000-4000-8000-000000000010',auth.uid(),'qa@example.com',10000,'','An integration test use case','{}','{}');
  IF result<>'received' THEN RAISE EXCEPTION 'Request not saved'; END IF;
  result := submit_mcp_usage_request('00000000-0000-4000-8000-000000000010',auth.uid(),'qa@example.com',10000,'','An integration test use case','{}','{}');
  IF result<>'received' OR (SELECT count(*) FROM mcp_usage_notifications)<>2 THEN RAISE EXCEPTION 'Duplicate request generated notifications'; END IF;
  result := submit_mcp_usage_request('00000000-0000-4000-8000-000000000010',auth.uid(),'qa@example.com',20000,'','An integration test use case','{}','{}');
  IF result<>'conflict' THEN RAISE EXCEPTION 'Request ID reused with changed payload'; END IF;
  SELECT count(*) INTO claimed FROM claim_mcp_usage_notifications();
  IF claimed<>2 THEN RAISE EXCEPTION 'Both channels not claimed'; END IF;
  SELECT count(*) INTO claimed FROM claim_mcp_usage_notifications();
  IF claimed<>0 THEN RAISE EXCEPTION 'Leased notifications claimed twice'; END IF;
  UPDATE mcp_usage_notifications SET state='sent' WHERE channel='email';
  UPDATE mcp_usage_notifications SET next_attempt_at=now() WHERE channel='line';
  SELECT count(*) INTO claimed FROM claim_mcp_usage_notifications();
  IF claimed<>1 THEN RAISE EXCEPTION 'Partial retry resends delivered channel'; END IF;
  PERFORM submit_mcp_usage_request('00000000-0000-4000-8000-000000000011',auth.uid(),'qa@example.com',10000,'','An integration test use case','{}','{}');
  PERFORM submit_mcp_usage_request('00000000-0000-4000-8000-000000000012',auth.uid(),'qa@example.com',10000,'','An integration test use case','{}','{}');
  result := submit_mcp_usage_request('00000000-0000-4000-8000-000000000013',auth.uid(),'qa@example.com',10000,'','An integration test use case','{}','{}');
  IF result<>'rate_limited' THEN RAISE EXCEPTION 'Daily notification spam guard missing'; END IF;
END $$;
${paidMigration}
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys WHERE key_name='free-a'),now(),false);
  IF r.allowed OR r.reason<>'subscription_required' OR r.monthly_quota<>0 THEN RAISE EXCEPTION 'Unpaid control traffic bypasses paid access'; END IF;
  SELECT * INTO r FROM consume_mcp_api_request_v2('internal-hash',now(),true);
  IF r.allowed THEN RAISE EXCEPTION 'NULL owner inferred internal access'; END IF;
  UPDATE mcp_api_keys SET internal_access=true WHERE key_hash='internal-hash';
  SELECT * INTO r FROM consume_mcp_api_request_v2('internal-hash',now(),true);
  IF NOT r.allowed THEN RAISE EXCEPTION 'Explicit internal key broken'; END IF;
  IF has_function_privilege('authenticated','claim_mcp_checkout(uuid)','EXECUTE') OR has_table_privilege('authenticated','mcp_api_keys','UPDATE') THEN RAISE EXCEPTION 'Billing/internal flag writable by user'; END IF;
  IF has_function_privilege('anon','consume_mcp_api_request(text,timestamptz)','EXECUTE') OR has_function_privilege('authenticated','consume_mcp_api_request(text,timestamptz)','EXECUTE') OR NOT has_function_privilege('service_role','consume_mcp_api_request(text,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Legacy metering RPC permissions unsafe'; END IF;
END $$;
INSERT INTO auth.users VALUES('00000000-0000-4000-8000-000000000003');
SELECT set_config('test.user_id','00000000-0000-4000-8000-000000000003',true);
DO $$ DECLARE lock1 uuid; lock2 uuid; BEGIN
  BEGIN
    PERFORM create_user_api_key('unpaid-key');
    RAISE EXCEPTION 'Unpaid key issuance unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'An active Starter or Pro%' THEN RAISE; END IF;
  END;
  lock1:=claim_mcp_checkout(auth.uid());lock2:=claim_mcp_checkout(auth.uid());
  IF lock1 IS NULL OR lock2 IS NOT NULL THEN RAISE EXCEPTION 'Concurrent checkout lease broken'; END IF;
  PERFORM release_mcp_checkout(auth.uid(),gen_random_uuid());
  IF claim_mcp_checkout(auth.uid()) IS NOT NULL THEN RAISE EXCEPTION 'Wrong owner released checkout'; END IF;
  PERFORM release_mcp_checkout(auth.uid(),lock1);
  IF claim_mcp_checkout(auth.uid()) IS NULL THEN RAISE EXCEPTION 'Checkout lease not released'; END IF;
END $$;
UPDATE mcp_billing_accounts SET stripe_customer_id='cus_paid_test' WHERE user_id=auth.uid();
SELECT sync_mcp_subscription_v2(auth.uid(),'cus_paid_test','sub_paid_test','active',now()+interval '1 month',false,now(),300,now(),'starter');
SELECT key_name FROM create_user_api_key('starter-a');
SELECT key_name FROM create_user_api_key('starter-b');
INSERT INTO mcp_api_usage_monthly(user_id,period_start,request_count) VALUES(auth.uid(),now(),499);
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys WHERE key_name='starter-a'),now(),true);
  IF NOT r.allowed OR r.monthly_quota<>500 OR r.monthly_count<>500 OR r.per_minute_quota<>10 THEN RAISE EXCEPTION 'Starter allowance/rate incorrect'; END IF;
  SELECT * INTO r FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys WHERE key_name='starter-b'),now(),true);
  IF r.allowed OR r.reason<>'monthly_limit_exceeded' THEN RAISE EXCEPTION 'Starter cap not shared'; END IF;
  SELECT * INTO r FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys WHERE key_name='starter-b'),now(),false);
  IF NOT r.allowed OR r.monthly_count<>500 THEN RAISE EXCEPTION 'Paid control traffic charged'; END IF;
END $$;
SELECT sync_mcp_subscription_v2(auth.uid(),'cus_paid_test','sub_paid_test','active',now()+interval '1 month',true,now(),300,now(),'pro');
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys WHERE key_name='starter-a'),now(),true);
  IF NOT r.allowed OR r.monthly_quota<>5000 OR r.monthly_count<>501 OR r.per_minute_quota<>30 THEN RAISE EXCEPTION 'Pro upgrade reset usage or scheduled cancellation removed access'; END IF;
END $$;
UPDATE mcp_api_usage_monthly SET request_count=4999 WHERE user_id=auth.uid();
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys WHERE key_name='starter-a'),now(),true);
  IF NOT r.allowed OR r.monthly_count<>5000 THEN RAISE EXCEPTION '5000th Pro request failed'; END IF;
  SELECT * INTO r FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys WHERE key_name='starter-b'),now(),true);
  IF r.allowed THEN RAISE EXCEPTION '5001st Pro request allowed'; END IF;
END $$;
SELECT sync_mcp_subscription_v2(auth.uid(),'cus_paid_test','sub_paid_test','active',now()-interval '1 second',false,now(),300,now()-interval '1 month','pro');
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys WHERE key_name='starter-a'),now(),false);
  IF r.allowed OR r.reason<>'subscription_required' THEN RAISE EXCEPTION 'Expired subscription has access'; END IF;
END $$;
-- Account deletion must not convert previously paid keys into internal keys.
DELETE FROM auth.users WHERE id=auth.uid();
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM consume_mcp_api_request_v2((SELECT key_hash FROM mcp_api_keys WHERE key_name='starter-a'),now(),true);
  IF r.allowed THEN RAISE EXCEPTION 'Orphan key bypassed subscription'; END IF;
END $$;
ROLLBACK;
`;
const result = spawnSync("psql", [url, "-X", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, encoding: "utf8" });
if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
console.log("Billing migrations passed: paid/free shared monthly caps, resets, unmetered controls, dashboard counts, internal keys, upgrade/downgrade, permissions and revocation. All local changes rolled back.");
