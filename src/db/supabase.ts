import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";

export function createSupabaseClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

