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
  VIP_DASHBOARD_ADMINS: z.string().optional(),
  VIP_DASHBOARD_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(10080).default(720),
  VIP_DASHBOARD_SESSION_COOKIE_NAME: z.string().default("vip_dashboard_session"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
});

export type VipDashboardAdminCredential = {
  username: string;
  password: string;
};

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
  vipDashboardAdmins: VipDashboardAdminCredential[];
  vipDashboardSessionTtlMinutes: number;
  vipDashboardSessionCookieName: string;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  resendApiKey: string | null;
};

function parseVipDashboardAdmins(raw: string | undefined): VipDashboardAdminCredential[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const separatorIndex = entry.indexOf(":");
      if (separatorIndex <= 0 || separatorIndex >= entry.length - 1) {
        throw new Error(
          "VIP_DASHBOARD_ADMINS must be a comma-separated list of username:password pairs.",
        );
      }

      const username = entry.slice(0, separatorIndex).trim();
      const password = entry.slice(separatorIndex + 1).trim();
      if (!username || !password) {
        throw new Error(
          "VIP_DASHBOARD_ADMINS contains an invalid username:password pair.",
        );
      }

      return {
        username,
        password,
      };
    });
}

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
  const vipDashboardAdmins = parseVipDashboardAdmins(parsed.VIP_DASHBOARD_ADMINS);

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
    vipDashboardAdmins,
    vipDashboardSessionTtlMinutes: parsed.VIP_DASHBOARD_SESSION_TTL_MINUTES,
    vipDashboardSessionCookieName: parsed.VIP_DASHBOARD_SESSION_COOKIE_NAME,
    stripeSecretKey: parsed.STRIPE_SECRET_KEY || null,
    stripeWebhookSecret: parsed.STRIPE_WEBHOOK_SECRET || null,
    resendApiKey: parsed.RESEND_API_KEY || null,
  };
}
