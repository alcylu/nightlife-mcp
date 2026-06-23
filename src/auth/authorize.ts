import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hashApiKey,
  isApiKeyAllowed,
  keyFingerprint,
} from "./apiKeys.js";

type ConsumeRpcRow = {
  allowed: boolean;
  reason: string;
  api_key_id: string | null;
  key_name: string | null;
  tier: string | null;
  daily_quota: number | null;
  daily_count: number | null;
  per_minute_quota: number | null;
  minute_count: number | null;
};

export interface ApiKeyContext {
  keyId: string;
  keyName: string | null;
  tier: string;
  fingerprint: string;
  source: "db" | "env";
  dailyQuota: number | null;
  dailyCount: number | null;
  minuteQuota: number | null;
  minuteCount: number | null;
  dailyRemaining: number | null;
  minuteRemaining: number | null;
}

export interface ApiAuthError {
  httpStatus: number;
  jsonRpcCode: number;
  message: string;
  retryAfterSec?: number;
}

type AuthOptions = {
  supabase: SupabaseClient;
  apiKey: string;
  useDbKeys: boolean;
  allowEnvFallback: boolean;
  envKeys: string[];
};

type AuthResult =
  | { ok: true; context: ApiKeyContext }
  | { ok: false; error: ApiAuthError };

function remaining(quota: number | null, count: number | null): number | null {
  if (quota === null || count === null) {
    return null;
  }
  return Math.max(0, quota - count);
}

function normalizeTier(value: string | null | undefined): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "free";
  }
  return raw;
}

function mapRpcRejection(reason: string): ApiAuthError {
  switch (reason) {
    case "invalid_key":
    case "revoked_key":
      return {
        httpStatus: 403,
        jsonRpcCode: -32003,
        message: "Invalid API key.",
      };
    case "minute_limit_exceeded":
      return {
        httpStatus: 429,
        jsonRpcCode: -32029,
        message: "Per-minute rate limit exceeded.",
        retryAfterSec: 60,
      };
    case "daily_limit_exceeded":
      return {
        httpStatus: 429,
        jsonRpcCode: -32029,
        message: "Daily API quota exceeded.",
        retryAfterSec: 3600,
      };
    default:
      return {
        httpStatus: 403,
        jsonRpcCode: -32003,
        message: "Invalid API key.",
      };
  }
}

function isRpcMissing(errorMessage: string): boolean {
  return (
    errorMessage.includes("Could not find the function") ||
    errorMessage.includes("does not exist") ||
    errorMessage.includes("function public.consume_mcp_api_request")
  );
}

// Supabase rejected the server's own credentials (not the caller's API key).
// Typically a wrong/expired SUPABASE_SERVICE_ROLE_KEY, or legacy anon/service_role
// keys disabled by Supabase. The fix is operational (update the server's key),
// NOT a DB migration.
function isServerCredentialError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes("invalid api key") ||
    msg.includes("legacy api keys are disabled") ||
    msg.includes("jwt") ||
    msg.includes("invalid authentication credentials")
  );
}

// Build an accurate "backend unavailable" error from the underlying RPC failure,
// so operators see the real cause instead of a misleading migration hint.
function backendUnavailableError(errorMessage: string): ApiAuthError {
  let detail: string;
  if (isRpcMissing(errorMessage)) {
    detail = "Run DB migration for consume_mcp_api_request().";
  } else if (isServerCredentialError(errorMessage)) {
    detail =
      "Supabase rejected the server's credentials — check SUPABASE_SERVICE_ROLE_KEY (it may be expired or a disabled legacy key).";
  } else {
    detail = "Could not reach the API key validation backend.";
  }
  return {
    httpStatus: 500,
    jsonRpcCode: -32603,
    message: `API key validation backend is unavailable. ${detail}`,
  };
}

function buildEnvContext(apiKey: string): ApiKeyContext {
  return {
    keyId: "env",
    keyName: "env-fallback",
    tier: "free",
    fingerprint: keyFingerprint(apiKey),
    source: "env",
    dailyQuota: null,
    dailyCount: null,
    minuteQuota: null,
    minuteCount: null,
    dailyRemaining: null,
    minuteRemaining: null,
  };
}

export async function authorizeApiKey(options: AuthOptions): Promise<AuthResult> {
  const {
    supabase,
    apiKey,
    useDbKeys,
    allowEnvFallback,
    envKeys,
  } = options;

  if (useDbKeys) {
    const keyHash = hashApiKey(apiKey);
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase.rpc("consume_mcp_api_request", {
      p_key_hash: keyHash,
      p_now: nowIso,
    });

    if (!error) {
      const row = Array.isArray(data)
        ? ((data[0] as ConsumeRpcRow | undefined) || null)
        : null;

      if (row) {
        if (!row.allowed) {
          // "invalid_key" means the hash wasn't found in the DB table.
          // If env fallback is allowed, don't reject — fall through to
          // the env key check so env-only keys still work.
          if (row.reason === "invalid_key" && allowEnvFallback) {
            // fall through to env key check below
          } else {
            return {
              ok: false,
              error: mapRpcRejection(row.reason),
            };
          }
        } else {
          return {
            ok: true,
            context: {
              keyId: row.api_key_id || "unknown",
              keyName: row.key_name,
              tier: normalizeTier(row.tier),
              fingerprint: keyFingerprint(apiKey),
              source: "db",
              dailyQuota: row.daily_quota,
              dailyCount: row.daily_count,
              minuteQuota: row.per_minute_quota,
              minuteCount: row.minute_count,
              dailyRemaining: remaining(row.daily_quota, row.daily_count),
              minuteRemaining: remaining(row.per_minute_quota, row.minute_count),
            },
          };
        }
      }

      // Key not found in DB (no row or invalid_key with fallback).
      // If env fallback is not allowed, reject.
      if (!allowEnvFallback) {
        return {
          ok: false,
          error: {
            httpStatus: 403,
            jsonRpcCode: -32003,
            message: "Invalid API key.",
          },
        };
      }
      // allowEnvFallback=true: fall through to env key check below
    } else {
      // RPC returned an error
      const errorMessage = String(error.message || "");
      if (!allowEnvFallback || !isRpcMissing(errorMessage)) {
        return {
          ok: false,
          error: backendUnavailableError(errorMessage),
        };
      }
      // RPC function missing + fallback allowed: fall through to env key check
    }
  }

  if (allowEnvFallback && isApiKeyAllowed(apiKey, envKeys)) {
    return { ok: true, context: buildEnvContext(apiKey) };
  }

  return {
    ok: false,
    error: {
      httpStatus: 403,
      jsonRpcCode: -32003,
      message: "Invalid API key.",
    },
  };
}

