import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeApiKey } from "./authorize.js";

// Minimal fake Supabase whose rpc() always returns the given error.
function supabaseRpcError(message: string): SupabaseClient {
  return {
    rpc: async () => ({ data: null, error: { message } }),
  } as unknown as SupabaseClient;
}

const baseOpts = {
  apiKey: "some-caller-key",
  useDbKeys: true,
  allowEnvFallback: false, // force the backend-error path (no env fallback)
  envKeys: [],
};

test("credential error surfaces SUPABASE_SERVICE_ROLE_KEY, not a migration hint", async () => {
  const result = await authorizeApiKey({
    ...baseOpts,
    supabase: supabaseRpcError("Legacy API keys are disabled"),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.httpStatus, 500);
  assert.match(result.error.message, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(
    result.error.message,
    /migration/i,
    "credential errors must not blame a DB migration",
  );
});

test("'Invalid API key' from Supabase is treated as a credential error", async () => {
  const result = await authorizeApiKey({
    ...baseOpts,
    supabase: supabaseRpcError("Invalid API key"),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("genuinely missing RPC still recommends the DB migration", async () => {
  const result = await authorizeApiKey({
    ...baseOpts,
    supabase: supabaseRpcError(
      "Could not find the function public.consume_mcp_api_request in the schema cache",
    ),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /migration for consume_mcp_api_request/);
});

test("unknown backend error falls back to a generic unavailable message", async () => {
  const result = await authorizeApiKey({
    ...baseOpts,
    supabase: supabaseRpcError("connection timed out"),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /backend is unavailable/i);
  assert.doesNotMatch(result.error.message, /migration/i);
});
