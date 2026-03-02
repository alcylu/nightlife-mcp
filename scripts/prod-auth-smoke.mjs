#!/usr/bin/env node

const config = {
  apiKey: process.env.NLT_API_KEY || process.env.NIGHTLIFE_API_KEY || "",
  mcpUrl: process.env.NLT_MCP_URL || "https://api.nightlife.dev/mcp",
  restBaseUrl: process.env.NLT_REST_BASE_URL || "https://api.nightlife.dev/api/v1",
  city: process.env.NLT_SMOKE_CITY || "tokyo",
};

function fail(message) {
  throw new Error(message);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseMcpPayload(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return parseJson(trimmed);

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");

  if (dataLines.length === 0) return null;
  return parseJson(dataLines[dataLines.length - 1]);
}

async function request(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  return { response, text };
}

async function checkPublicEndpoints() {
  const health = await request("https://api.nightlife.dev/health");
  if (health.response.status !== 200) {
    fail(`/health failed with ${health.response.status}`);
  }

  const docs = await request(`${config.restBaseUrl}/docs`);
  if (docs.response.status !== 200) {
    fail(`/api/v1/docs failed with ${docs.response.status}`);
  }

  const openapi = await request(`${config.restBaseUrl}/openapi.json`);
  if (openapi.response.status !== 200) {
    fail(`/api/v1/openapi.json failed with ${openapi.response.status}`);
  }
}

async function checkAuthenticatedRest() {
  const headers = { "x-api-key": config.apiKey };

  const cities = await request(`${config.restBaseUrl}/cities`, { headers });
  if (cities.response.status !== 200) {
    fail(`/api/v1/cities failed with ${cities.response.status}: ${cities.text.slice(0, 200)}`);
  }

  const genres = await request(`${config.restBaseUrl}/genres`, { headers });
  if (genres.response.status !== 200) {
    fail(`/api/v1/genres failed with ${genres.response.status}: ${genres.text.slice(0, 200)}`);
  }

  const tonight = await request(
    `${config.restBaseUrl}/events/tonight?city=${encodeURIComponent(config.city)}&limit=1`,
    { headers },
  );
  if (tonight.response.status !== 200) {
    fail(
      `/api/v1/events/tonight failed with ${tonight.response.status}: ${tonight.text.slice(0, 200)}`,
    );
  }
}

async function checkAuthenticatedMcp() {
  const baseHeaders = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-api-key": config.apiKey,
  };

  const initialize = await request(config.mcpUrl, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "smoke-init",
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "prod-auth-smoke", version: "1.0.0" },
      },
    }),
  });

  if (initialize.response.status !== 200) {
    fail(`MCP initialize failed with ${initialize.response.status}: ${initialize.text.slice(0, 200)}`);
  }

  const sessionId = initialize.response.headers.get("mcp-session-id");
  if (!sessionId) {
    fail("MCP initialize succeeded but no mcp-session-id header was returned.");
  }

  const initPayload = parseMcpPayload(initialize.text);
  if (!initPayload || initPayload.error) {
    fail(`MCP initialize returned invalid payload: ${initialize.text.slice(0, 300)}`);
  }

  const sessionHeaders = {
    ...baseHeaders,
    "mcp-session-id": sessionId,
  };

  const listTools = await request(config.mcpUrl, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "smoke-tools-list",
      method: "tools/list",
      params: {},
    }),
  });

  if (listTools.response.status !== 200) {
    fail(`MCP tools/list failed with ${listTools.response.status}: ${listTools.text.slice(0, 200)}`);
  }

  const listPayload = parseMcpPayload(listTools.text);
  if (!listPayload || listPayload.error) {
    fail(`MCP tools/list returned invalid payload: ${listTools.text.slice(0, 300)}`);
  }

  const callTool = await request(config.mcpUrl, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "smoke-tool-call",
      method: "tools/call",
      params: {
        name: "get_tonight",
        arguments: {
          city: config.city,
          limit: 1,
        },
      },
    }),
  });

  if (callTool.response.status !== 200) {
    fail(`MCP tools/call failed with ${callTool.response.status}: ${callTool.text.slice(0, 200)}`);
  }

  const callPayload = parseMcpPayload(callTool.text);
  if (!callPayload || callPayload.error) {
    fail(`MCP tools/call returned invalid payload: ${callTool.text.slice(0, 300)}`);
  }
}

async function main() {
  if (!config.apiKey) {
    fail("Missing API key. Set NLT_API_KEY (or NIGHTLIFE_API_KEY).");
  }

  await checkPublicEndpoints();
  await checkAuthenticatedRest();
  await checkAuthenticatedMcp();

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          "public-health-openapi-docs",
          "authenticated-rest-cities-genres-events-tonight",
          "authenticated-mcp-initialize-tools-list-tools-call",
        ],
        mcp_url: config.mcpUrl,
        rest_base_url: config.restBaseUrl,
        city: config.city,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`prod-auth-smoke failed: ${message}`);
  process.exit(1);
});
