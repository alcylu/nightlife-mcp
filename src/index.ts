#!/usr/bin/env node

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSupabaseClient } from "./db/supabase.js";
import { loadConfig } from "./config.js";
import { createNightlifeServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const supabase = createSupabaseClient(config);
  const server = createNightlifeServer(config, supabase);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error(
    `[${config.serverName}] running on stdio (${config.serverVersion})`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[nightlife-mcp] failed to start: ${message}`);
  process.exit(1);
});
