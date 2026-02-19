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

      if (!row) {
        return {
          ok: false,
          error: {
            httpStatus: 403,
            jsonRpcCode: -32003,
            message: "Invalid API key.",
          },
        };
      }

      if (!row.allowed) {
        return {
          ok: false,
          error: mapRpcRejection(row.reason),
        };
      }

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

    const errorMessage = String(error.message || "");
    if (!allowEnvFallback || !isRpcMissing(errorMessage)) {
      return {
        ok: false,
        error: {
          httpStatus: 500,
          jsonRpcCode: -32603,
          message:
            "API key validation backend is unavailable. Run DB migration for consume_mcp_api_request().",
        },
      };
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

