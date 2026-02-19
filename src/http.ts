#!/usr/bin/env node

import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSupabaseClient } from "./db/supabase.js";
import { loadConfig } from "./config.js";
import { createNightlifeServer } from "./server.js";
import {
  extractApiKeyFromHeaders,
} from "./auth/apiKeys.js";
import { authorizeApiKey } from "./auth/authorize.js";
import {
  logEvent,
  recordHttpAuthResult,
  recordHttpRequest,
  snapshotRuntimeMetrics,
} from "./observability/metrics.js";

type SessionContext = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  apiKeyFingerprint: string;
  apiKeyId: string;
  apiKeyTier: string;
  createdAt: number;
};

type RequestWithAuth = Request & {
  apiKey?: string;
  apiKeyFingerprint?: string;
  apiKeyId?: string;
  apiKeyTier?: string;
  apiKeySource?: "db" | "env";
};

const SESSION_HEADER = "mcp-session-id";

function isInitializeRequestBody(body: unknown): body is { method: "initialize" } {
  return (
    !!body &&
    typeof body === "object" &&
    (body as Record<string, unknown>).jsonrpc === "2.0" &&
    (body as Record<string, unknown>).method === "initialize"
  );
}

function getSessionId(req: Request): string | null {
  const raw = req.headers[SESSION_HEADER];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (Array.isArray(raw)) {
    const first = raw.find((value) => value.trim().length > 0);
    return first ? first.trim() : null;
  }
  return null;
}

function sendJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
): void {
  if (res.headersSent) {
    return;
  }
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (
    config.mcpHttpRequireApiKey &&
    !config.mcpHttpUseDbKeys &&
    config.mcpHttpApiKeys.length === 0
  ) {
    throw new Error(
      "MCP_HTTP_REQUIRE_API_KEY=true but no key source is configured.",
    );
  }

  const app = createMcpExpressApp({ host: config.httpHost });
  const supabase = createSupabaseClient(config);
  const sessions = new Map<string, SessionContext>();

  app.use((req: RequestWithAuth, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      recordHttpRequest({
        method: req.method,
        statusCode: res.statusCode,
      });
      logEvent("http.request", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: durationMs,
        api_key_id: req.apiKeyId || null,
        api_key_tier: req.apiKeyTier || null,
        session_id: getSessionId(req),
      });
    });
    next();
  });

  const cleanupSession = async (sessionId: string): Promise<void> => {
    const context = sessions.get(sessionId);
    if (!context) {
      return;
    }

    sessions.delete(sessionId);
    await Promise.allSettled([context.transport.close(), context.server.close()]);
  };

  app.use("/mcp", async (req: RequestWithAuth, res, next) => {
    if (!config.mcpHttpRequireApiKey) {
      next();
      return;
    }

    const apiKey = extractApiKeyFromHeaders(req.headers as Record<string, unknown>);
    if (!apiKey) {
      recordHttpAuthResult(false);
      res.setHeader("WWW-Authenticate", "Bearer");
      sendJsonRpcError(res, 401, -32001, "API key required.");
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
      sendJsonRpcError(
        res,
        auth.error.httpStatus,
        auth.error.jsonRpcCode,
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
  });

  app.post("/mcp", async (req: RequestWithAuth, res: Response) => {
    try {
      const sessionId = getSessionId(req);

      if (sessionId) {
        const context = sessions.get(sessionId);
        if (!context) {
          sendJsonRpcError(res, 404, -32004, "Unknown session ID.");
          return;
        }

        if (
          config.mcpHttpRequireApiKey &&
          req.apiKeyFingerprint &&
          context.apiKeyFingerprint !== req.apiKeyFingerprint
        ) {
          sendJsonRpcError(res, 403, -32003, "Session not valid for this API key.");
          return;
        }

        await context.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequestBody(req.body)) {
        sendJsonRpcError(
          res,
          400,
          -32000,
          "Initialize request required when no session ID is present.",
        );
        return;
      }

      const server = createNightlifeServer(config, supabase);
      let transport: StreamableHTTPServerTransport;

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, {
            server,
            transport,
            apiKeyFingerprint: req.apiKeyFingerprint || "anonymous",
            apiKeyId: req.apiKeyId || "anonymous",
            apiKeyTier: req.apiKeyTier || "free",
            createdAt: Date.now(),
          });
        },
        onsessionclosed: async (closedSessionId) => {
          await cleanupSession(closedSessionId);
        },
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("http.post.error", {
        message,
      });
      sendJsonRpcError(res, 500, -32603, "Internal server error.");
    }
  });

  app.get("/mcp", async (req: RequestWithAuth, res: Response) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId) {
        sendJsonRpcError(res, 400, -32000, "Session ID header is required.");
        return;
      }

      const context = sessions.get(sessionId);
      if (!context) {
        sendJsonRpcError(res, 404, -32004, "Unknown session ID.");
        return;
      }

      if (
        config.mcpHttpRequireApiKey &&
        req.apiKeyFingerprint &&
        context.apiKeyFingerprint !== req.apiKeyFingerprint
      ) {
        sendJsonRpcError(res, 403, -32003, "Session not valid for this API key.");
        return;
      }

      await context.transport.handleRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("http.get.error", {
        message,
      });
      sendJsonRpcError(res, 500, -32603, "Internal server error.");
    }
  });

  app.delete("/mcp", async (req: RequestWithAuth, res: Response) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId) {
        sendJsonRpcError(res, 400, -32000, "Session ID header is required.");
        return;
      }

      const context = sessions.get(sessionId);
      if (!context) {
        sendJsonRpcError(res, 404, -32004, "Unknown session ID.");
        return;
      }

      if (
        config.mcpHttpRequireApiKey &&
        req.apiKeyFingerprint &&
        context.apiKeyFingerprint !== req.apiKeyFingerprint
      ) {
        sendJsonRpcError(res, 403, -32003, "Session not valid for this API key.");
        return;
      }

      await context.transport.handleRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("http.delete.error", {
        message,
      });
      sendJsonRpcError(res, 500, -32603, "Internal server error.");
    }
  });

  app.get("/health", async (_req, res) => {
    const runtime = snapshotRuntimeMetrics();

    // MCP stats — non-blocking, won't fail health check
    let mcp_stats: { total_users: number | null; api_calls_24h: number | null } = {
      total_users: null,
      api_calls_24h: null,
    };
    try {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      const [usersRes, usageRes] = await Promise.all([
        supabase
          .from("mcp_api_keys")
          .select("user_id")
          .not("user_id", "is", null)
          .eq("status", "active"),
        supabase
          .from("mcp_api_usage_daily")
          .select("request_count")
          .gte("usage_date", yesterday),
      ]);

      if (usersRes.data) {
        const uniqueUsers = new Set(usersRes.data.map((r: any) => r.user_id));
        mcp_stats.total_users = uniqueUsers.size;
      }
      if (usageRes.data) {
        mcp_stats.api_calls_24h = usageRes.data.reduce(
          (sum: number, r: any) => sum + (r.request_count || 0), 0
        );
      }
    } catch {
      // Non-blocking — health check still succeeds
    }

    res.json({
      ok: true,
      transport: "streamable-http",
      sessions: sessions.size,
      tiers: Array.from(sessions.values()).reduce<Record<string, number>>((acc, item) => {
        acc[item.apiKeyTier] = (acc[item.apiKeyTier] || 0) + 1;
        return acc;
      }, {}),
      uptime_sec: Math.floor(process.uptime()),
      runtime_metrics: runtime,
      mcp_stats,
    });
  });

  const listener = app.listen(config.httpPort, config.httpHost, () => {
    console.error(
      `[nightlife-mcp] HTTP listening on http://${config.httpHost}:${config.httpPort}/mcp`,
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.error(`[nightlife-mcp] shutting down (${signal})`);
    listener.close();
    const ids = Array.from(sessions.keys());
    await Promise.all(ids.map((id) => cleanupSession(id)));
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[nightlife-mcp] failed to start HTTP server: ${message}`);
  process.exit(1);
});
