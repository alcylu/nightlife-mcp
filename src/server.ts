import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config.js";
import { registerEventTools } from "./tools/events.js";

export function createNightlifeServer(
  config: AppConfig,
  supabase: SupabaseClient,
): McpServer {
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  registerEventTools(server, { config, supabase });
  return server;
}

