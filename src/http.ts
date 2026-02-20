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

function recommendationsDebugPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nightlife MCP Debug UI</title>
  <style>
    :root {
      --bg: #0d1117;
      --panel: #161b22;
      --text: #e6edf3;
      --muted: #9da7b3;
      --accent: #2f81f7;
      --border: #30363d;
      --ok: #238636;
    }
    body {
      margin: 0;
      font-family: Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      background: var(--bg);
      color: var(--text);
      line-height: 1.4;
    }
    .container {
      max-width: 980px;
      margin: 0 auto;
      padding: 24px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 22px;
    }
    .sub {
      color: var(--muted);
      margin-bottom: 16px;
      font-size: 13px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    label {
      display: block;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 4px;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #0b0f14;
      color: var(--text);
    }
    input[readonly] {
      opacity: 0.8;
    }
    button {
      border: 0;
      border-radius: 8px;
      padding: 10px 14px;
      background: var(--accent);
      color: white;
      font-weight: 700;
      cursor: pointer;
      margin-right: 8px;
      margin-top: 10px;
    }
    .secondary {
      background: #30363d;
    }
    .status {
      font-size: 12px;
      color: var(--muted);
      margin-top: 8px;
      word-break: break-all;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    .summary-box {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      background: #0b0f14;
    }
    .summary-label {
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 4px;
    }
    .summary-value {
      font-size: 14px;
      font-weight: 700;
      word-break: break-word;
    }
    .reco-list {
      display: grid;
      gap: 10px;
    }
    .reco-card {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      background: #0b0f14;
    }
    .reco-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .rank {
      color: #79c0ff;
      font-weight: 700;
      font-size: 12px;
      white-space: nowrap;
    }
    .modal {
      font-size: 12px;
      color: var(--muted);
    }
    .event-title a {
      color: var(--text);
      text-decoration: none;
      border-bottom: 1px dotted var(--muted);
    }
    .event-title a:hover {
      border-bottom-color: var(--text);
    }
    .meta {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    .pills {
      margin-top: 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .pill {
      font-size: 11px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 8px;
      color: #c9d1d9;
      background: #121821;
    }
    .why {
      margin-top: 8px;
      padding-left: 18px;
      color: #d2d8df;
      font-size: 12px;
    }
    .callout {
      border: 1px solid var(--border);
      border-left: 4px solid #d29922;
      background: #0b0f14;
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 12px;
      font-size: 12px;
    }
    details {
      margin-top: 10px;
    }
    details > summary {
      cursor: pointer;
      color: var(--muted);
      margin-bottom: 8px;
    }
    pre {
      margin: 0;
      overflow: auto;
      max-height: 60vh;
      background: #0b0f14;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      font-size: 12px;
    }
    @media (max-width: 800px) {
      .grid { grid-template-columns: 1fr; }
      .summary-grid { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Nightlife MCP Debug UI</h1>
    <div class="sub">Initialize a session, list tools, and call <code>get_recommendations</code>.</div>

    <div class="panel">
      <div class="grid">
        <div>
          <label>MCP Endpoint</label>
          <input id="endpoint" value="/mcp" />
        </div>
        <div>
          <label>API Key (optional)</label>
          <input id="apiKey" placeholder="x-api-key value" />
        </div>
        <div>
          <label>Session ID</label>
          <input id="sessionId" readonly placeholder="Not initialized" />
        </div>
      </div>
      <button id="initBtn">1) Initialize Session</button>
      <button id="listBtn" class="secondary">2) List Tools</button>
      <div id="status" class="status">Ready.</div>
    </div>

    <div class="panel">
      <div class="grid">
        <div>
          <label>City</label>
          <input id="city" value="tokyo" />
        </div>
        <div>
          <label>Date</label>
          <input id="date" value="tonight" />
        </div>
        <div>
          <label>Limit (max 10)</label>
          <input id="limit" value="10" />
        </div>
        <div>
          <label>Area (optional)</label>
          <input id="area" placeholder="shibuya" />
        </div>
        <div>
          <label>Genre (optional)</label>
          <input id="genre" placeholder="techno" />
        </div>
        <div>
          <label>Query (optional)</label>
          <input id="query" placeholder="warehouse" />
        </div>
      </div>
      <button id="recoBtn">3) Call get_recommendations</button>
    </div>

    <div class="panel">
      <label>Readable Output</label>
      <div class="summary-grid">
        <div class="summary-box">
          <div class="summary-label">City</div>
          <div id="summaryCity" class="summary-value">-</div>
        </div>
        <div class="summary-box">
          <div class="summary-label">Date Filter</div>
          <div id="summaryDate" class="summary-value">-</div>
        </div>
        <div class="summary-box">
          <div class="summary-label">Result Count</div>
          <div id="summaryCount" class="summary-value">-</div>
        </div>
        <div class="summary-box">
          <div class="summary-label">Status</div>
          <div id="summaryStatus" class="summary-value">Ready</div>
        </div>
      </div>
      <div id="readable"></div>
      <details>
        <summary>Raw JSON</summary>
        <pre id="output">{}</pre>
      </details>
    </div>
  </div>

  <script>
    const state = { sessionId: "" };

    const el = (id) => document.getElementById(id);
    const setStatus = (msg) => { el("status").textContent = msg; };

    function escapeHtml(input) {
      return String(input || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function updateSummary(data) {
      el("summaryCity").textContent = data && data.city ? data.city : "-";
      el("summaryDate").textContent = data && data.date_filter ? data.date_filter : "-";
      el("summaryCount").textContent =
        data && typeof data.result_count === "number" ? String(data.result_count) : "-";
      if (data && data.unavailable_city) {
        el("summaryStatus").textContent = "Unsupported city";
      } else if (data && Array.isArray(data.recommendations)) {
        el("summaryStatus").textContent = "Recommendations loaded";
      } else {
        el("summaryStatus").textContent = "Raw response";
      }
    }

    function extractStructured(payload) {
      if (!payload || typeof payload !== "object") {
        return null;
      }
      if (payload.result && payload.result.structuredContent) {
        return payload.result.structuredContent;
      }
      if (payload.structuredContent) {
        return payload.structuredContent;
      }
      try {
        const text =
          payload.result &&
          payload.result.content &&
          payload.result.content[0] &&
          payload.result.content[0].text;
        if (typeof text === "string" && text.trim().startsWith("{")) {
          return JSON.parse(text);
        }
      } catch (_err) {
        // ignore parse failure and fall back to raw output only
      }
      return null;
    }

    function renderReadable(payload) {
      const container = el("readable");
      container.innerHTML = "";

      const structured = extractStructured(payload);
      updateSummary(structured);

      if (!structured) {
        container.innerHTML = '<div class="callout">No structured recommendation payload detected. Use Raw JSON below.</div>';
        return;
      }

      if (structured.unavailable_city) {
        const u = structured.unavailable_city;
        const available = Array.isArray(u.available_cities) ? u.available_cities.join(", ") : "";
        container.innerHTML =
          '<div class="callout">' +
          '<strong>Unsupported city:</strong> ' + escapeHtml(u.requested_city || "") + '<br />' +
          escapeHtml(u.message || "") + '<br />' +
          '<strong>Available:</strong> ' + escapeHtml(available) + '<br />' +
          '<a href="' + escapeHtml(u.request_city_url || "#") + '" target="_blank" rel="noreferrer" style="color:#79c0ff">Request city support</a>' +
          "</div>";
        return;
      }

      const recs = Array.isArray(structured.recommendations) ? structured.recommendations : [];
      if (recs.length === 0) {
        container.innerHTML = '<div class="callout">No recommendations returned for this query.</div>';
        return;
      }

      const cards = recs.map((rec) => {
        const event = rec.event || {};
        const genres = Array.isArray(event.genres) ? event.genres : [];
        const why = Array.isArray(rec.why_this_fits) ? rec.why_this_fits : [];
        const pills = genres.length > 0
          ? genres.slice(0, 6).map((g) => '<span class="pill">' + escapeHtml(g) + "</span>").join("")
          : '<span class="pill">No genre tags</span>';
        const whyItems = why.length > 0
          ? why.map((r) => "<li>" + escapeHtml(r) + "</li>").join("")
          : "<li>No reason text provided.</li>";

        return (
          '<div class="reco-card">' +
            '<div class="reco-head">' +
              '<div>' +
                '<div class="rank">#' + escapeHtml(rec.rank) + " • " + escapeHtml(rec.modal_name || rec.modal_id || "Modal") + "</div>" +
                '<div class="modal">' + escapeHtml(rec.modal_description || "") + "</div>" +
              "</div>" +
            "</div>" +
            '<div class="event-title"><a href="' + escapeHtml(event.nlt_url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(event.name || "Untitled Event") + "</a></div>" +
            '<div class="meta">Venue: ' + escapeHtml((event.venue && event.venue.name) || "Unknown Venue") + " • Area: " + escapeHtml((event.venue && event.venue.area) || "N/A") + " • Date: " + escapeHtml(event.date || "N/A") + "</div>" +
            '<div class="pills">' + pills + "</div>" +
            '<ul class="why">' + whyItems + "</ul>" +
          "</div>"
        );
      }).join("");

      container.innerHTML = '<div class="reco-list">' + cards + "</div>";
    }

    const setOutput = (obj) => {
      el("output").textContent = JSON.stringify(obj, null, 2);
      renderReadable(obj);
    };

    function parseResponsePayload(rawText) {
      const text = String(rawText || "").trim();
      if (!text) return {};
      if (text.startsWith("{")) return JSON.parse(text);

      const dataLines = text
        .split("\\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      if (dataLines.length > 0) {
        return JSON.parse(dataLines[dataLines.length - 1]);
      }

      throw new Error("Unable to parse server response.");
    }

    async function rpcCall(method, params) {
      const endpoint = el("endpoint").value.trim() || "/mcp";
      const apiKey = el("apiKey").value.trim();
      const headers = {
        "content-type": "application/json",
        "accept": "application/json, text/event-stream"
      };
      if (state.sessionId) {
        headers["mcp-session-id"] = state.sessionId;
      }
      if (apiKey) {
        headers["x-api-key"] = apiKey;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method,
          params
        })
      });

      const nextSession = res.headers.get("mcp-session-id");
      if (nextSession) {
        state.sessionId = nextSession;
        el("sessionId").value = nextSession;
      }

      const raw = await res.text();
      let parsed;
      try {
        parsed = parseResponsePayload(raw);
      } catch (err) {
        parsed = { parse_error: String(err), raw };
      }

      if (!res.ok) {
        throw new Error("HTTP " + res.status + " " + JSON.stringify(parsed));
      }

      return parsed;
    }

    el("initBtn").addEventListener("click", async () => {
      setStatus("Initializing...");
      try {
        const payload = await rpcCall("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "debug-ui", version: "0.1.0" }
        });
        setOutput(payload);
        setStatus("Initialized. Session ready.");
      } catch (error) {
        setStatus("Initialize failed.");
        setOutput({ error: String(error) });
      }
    });

    el("listBtn").addEventListener("click", async () => {
      setStatus("Listing tools...");
      try {
        const payload = await rpcCall("tools/list", {});
        setOutput(payload);
        setStatus("Tools listed.");
      } catch (error) {
        setStatus("tools/list failed.");
        setOutput({ error: String(error) });
      }
    });

    el("recoBtn").addEventListener("click", async () => {
      setStatus("Calling get_recommendations...");
      const args = {
        city: el("city").value.trim() || undefined,
        date: el("date").value.trim() || undefined,
        limit: Number(el("limit").value || "10"),
        area: el("area").value.trim() || undefined,
        genre: el("genre").value.trim() || undefined,
        query: el("query").value.trim() || undefined
      };

      try {
        const payload = await rpcCall("tools/call", {
          name: "get_recommendations",
          arguments: args
        });
        setOutput(payload);
        setStatus("get_recommendations complete.");
      } catch (error) {
        setStatus("get_recommendations failed.");
        setOutput({ error: String(error) });
      }
    });
  </script>
</body>
</html>`;
}

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

  app.get("/debug/recommendations", (_req, res) => {
    res.type("html").send(recommendationsDebugPageHtml());
  });

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
