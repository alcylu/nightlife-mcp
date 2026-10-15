import { test } from "node:test";
import assert from "node:assert/strict";
import { isBillableMcpRequest } from "./metering.js";
import { authorizeApiKey } from "./authorize.js";
import type { SupabaseClient } from "@supabase/supabase-js";

test("only MCP tool calls consume monthly allowance", () => {
  assert.equal(isBillableMcpRequest("POST", { method: "tools/call" }), true);
  for (const method of ["initialize", "tools/list", "notifications/initialized", "ping"]) assert.equal(isBillableMcpRequest("POST", { method }), false);
  assert.equal(isBillableMcpRequest("GET", undefined), false);
  assert.equal(isBillableMcpRequest("DELETE", undefined), false);
});

test("monthly quota exhaustion is a 429 and does not fall back to env keys", async () => {
  let rpcName; let params;
  const db = { async rpc(name: string, p: unknown) { rpcName = name; params = p; return { data: [{ allowed: false, reason: "monthly_limit_exceeded" }], error: null }; } } as unknown as SupabaseClient;
  const result = await authorizeApiKey({ supabase: db, apiKey: "test", useDbKeys: true, allowEnvFallback: true, envKeys: ["test"], monthlyLimitsEnabled: true, billable: false });
  assert.equal(rpcName, "consume_mcp_api_request_v2");
  assert.equal((params as any).p_billable, false);
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.error.httpStatus, 429); assert.match(result.error.message, /Monthly/); }
});
