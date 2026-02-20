import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SERVER_NAME: z.string().default("nightlife-mcp"),
  SERVER_VERSION: z.string().default("0.1.0"),
  DEFAULT_CITY: z.string().default("tokyo"),
  DEFAULT_COUNTRY_CODE: z
    .string()
    .min(2)
    .max(2)
    .default("JP")
    .transform((value) => value.toUpperCase()),
  NIGHTLIFE_BASE_URL: z.string().url().default("https://nightlifetokyo.com"),
  MCP_TOP_LEVEL_CITIES: z.string().optional(),
  HTTP_HOST: z.string().default("0.0.0.0"),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  MCP_HTTP_REQUIRE_API_KEY: z
    .string()
    .default("true")
    .transform((value) => value.trim().toLowerCase() !== "false"),
  MCP_HTTP_USE_DB_KEYS: z
    .string()
    .default("true")
    .transform((value) => value.trim().toLowerCase() !== "false"),
  MCP_HTTP_ALLOW_ENV_KEY_FALLBACK: z
    .string()
    .default("true")
    .transform((value) => value.trim().toLowerCase() !== "false"),
  MCP_HTTP_API_KEYS: z.string().optional(),
  MCP_ENABLE_RECOMMENDATIONS: z
    .string()
    .default("false")
    .transform((value) => value.trim().toLowerCase() !== "false"),
});

export type AppConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  serverName: string;
  serverVersion: string;
  defaultCity: string;
  defaultCountryCode: string;
  nightlifeBaseUrl: string;
  topLevelCities: string[];
  httpHost: string;
  httpPort: number;
  mcpHttpRequireApiKey: boolean;
  mcpHttpUseDbKeys: boolean;
  mcpHttpAllowEnvKeyFallback: boolean;
  mcpHttpApiKeys: string[];
  mcpEnableRecommendations: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const keys = (parsed.MCP_HTTP_API_KEYS || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const topLevelCities = (parsed.MCP_TOP_LEVEL_CITIES || `${parsed.DEFAULT_CITY},san-francisco`)
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  return {
    supabaseUrl: parsed.SUPABASE_URL,
    supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    serverName: parsed.SERVER_NAME,
    serverVersion: parsed.SERVER_VERSION,
    defaultCity: parsed.DEFAULT_CITY.toLowerCase(),
    defaultCountryCode: parsed.DEFAULT_COUNTRY_CODE,
    nightlifeBaseUrl: parsed.NIGHTLIFE_BASE_URL.replace(/\/+$/, ""),
    topLevelCities,
    httpHost: parsed.HTTP_HOST,
    httpPort: parsed.HTTP_PORT ?? parsed.PORT ?? 3000,
    mcpHttpRequireApiKey: parsed.MCP_HTTP_REQUIRE_API_KEY,
    mcpHttpUseDbKeys: parsed.MCP_HTTP_USE_DB_KEYS,
    mcpHttpAllowEnvKeyFallback: parsed.MCP_HTTP_ALLOW_ENV_KEY_FALLBACK,
    mcpHttpApiKeys: keys,
    mcpEnableRecommendations: parsed.MCP_ENABLE_RECOMMENDATIONS,
  };
}
