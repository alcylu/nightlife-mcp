import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config.js";
import { registerEventTools } from "./tools/events.js";
import { registerVenueTools } from "./tools/venues.js";
import { registerPerformerTools } from "./tools/performers.js";
import { registerRequestTools } from "./tools/requests.js";
import { registerVipBookingTools } from "./tools/vipBookings.js";
import { registerVipAgentOpsTools } from "./tools/vipAgentOps.js";
import { registerVipPricingTool } from "./tools/vipTables.js";
import { registerVipTableOpsTools } from "./tools/vipTableOps.js";
import { registerHelperTools } from "./tools/helpers.js";
import { registerGuestListTools } from "./tools/guestList.js";
import { registerDepositOpsTools } from "./tools/deposits.js";

export type ServerOptions = {
  includeOpsTools?: boolean;
};

export function createNightlifeServer(
  config: AppConfig,
  supabase: SupabaseClient,
  options: ServerOptions = {},
): McpServer {
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  registerEventTools(server, { config, supabase });
  registerVenueTools(server, { config, supabase });
  registerPerformerTools(server, { config, supabase });
  registerRequestTools(server, { supabase });
  registerVipBookingTools(server, { supabase, config });
  registerVipPricingTool(server, { supabase });
  registerHelperTools(server, { config, supabase });
  registerGuestListTools(server, { supabase });
  if (options.includeOpsTools) {
    registerVipAgentOpsTools(server, { supabase, config });
    registerVipTableOpsTools(server, { supabase });
    registerDepositOpsTools(server, { supabase, config });
  }
  return server;
}
