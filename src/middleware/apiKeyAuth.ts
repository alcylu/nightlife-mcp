import type { Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { extractApiKeyFromHeaders } from "../auth/apiKeys.js";
import { authorizeApiKey } from "../auth/authorize.js";
import {
  recordHttpAuthResult,
} from "../observability/metrics.js";

export type RequestWithAuth = Request & {
  apiKey?: string;
  apiKeyFingerprint?: string;
  apiKeyId?: string;
  apiKeyTier?: string;
  apiKeySource?: "db" | "env";
};

function sendJsonError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  if (res.headersSent) {
    return;
  }
  res.status(status).json({ error: { code, message } });
}

export function createApiKeyAuthMiddleware(deps: {
  supabase: SupabaseClient;
  config: AppConfig;
}) {
  const { supabase, config } = deps;

  return async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    if (!config.mcpHttpRequireApiKey) {
      next();
      return;
    }

    const apiKey = extractApiKeyFromHeaders(req.headers as Record<string, unknown>);
    if (!apiKey) {
      recordHttpAuthResult(false);
      res.setHeader("WWW-Authenticate", "Bearer");
      sendJsonError(res, 401, "UNAUTHORIZED", "API key required.");
      return;
    }

    const auth = await authorizeApiKey({
      supabase,
      apiKey,
      useDbKeys: config.mcpHttpUseDbKeys,
      allowEnvFallback: config.mcpHttpAllowEnvKeyFallback,
      envKeys: config.mcpHttpApiKeys,
    });

    if (!auth.ok) {
      recordHttpAuthResult(false);
      if (auth.error.retryAfterSec) {
        res.setHeader("Retry-After", String(auth.error.retryAfterSec));
      }
      sendJsonError(
        res,
        auth.error.httpStatus,
        "AUTH_FAILED",
        auth.error.message,
      );
      return;
    }
    recordHttpAuthResult(true);

    if (auth.context.dailyQuota !== null) {
      res.setHeader("X-RateLimit-Daily-Limit", String(auth.context.dailyQuota));
    }
    if (auth.context.dailyRemaining !== null) {
      res.setHeader("X-RateLimit-Daily-Remaining", String(auth.context.dailyRemaining));
    }
    if (auth.context.minuteQuota !== null) {
      res.setHeader("X-RateLimit-Minute-Limit", String(auth.context.minuteQuota));
    }
    if (auth.context.minuteRemaining !== null) {
      res.setHeader("X-RateLimit-Minute-Remaining", String(auth.context.minuteRemaining));
    }
    res.setHeader("X-API-Key-Tier", auth.context.tier);
    res.setHeader("X-API-Key-Source", auth.context.source);

    req.apiKey = apiKey;
    req.apiKeyFingerprint = auth.context.fingerprint;
    req.apiKeyId = auth.context.keyId;
    req.apiKeyTier = auth.context.tier;
    req.apiKeySource = auth.context.source;
    next();
  };
}
