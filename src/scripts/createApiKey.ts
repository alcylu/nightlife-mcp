#!/usr/bin/env node

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { loadConfig } from "../config.js";
import { createSupabaseClient } from "../db/supabase.js";
import { hashApiKey, keyFingerprint } from "../auth/apiKeys.js";

type Tier = "free" | "starter" | "enterprise";

type CliOptions = {
  name: string;
  tier: Tier;
  dailyQuota: number | null;
  minuteQuota: number | null;
  apiKey: string;
  metadata: Record<string, unknown>;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run key:create -- [options]",
    "",
    "Options:",
    "  --name <string>             Key display name (default: generated)",
    "  --tier <free|starter|enterprise> (default: free)",
    "  --daily-quota <number|unlimited> (default: 100)",
    "  --minute-quota <number|unlimited> (default: 20)",
    "  --key <string>              Provide explicit key value (default: generated)",
    "  --metadata '<json>'         Metadata JSON object (default: {})",
    "  --help                      Show this help",
  ].join("\n");
}

function parseQuota(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "unlimited" || normalized === "null") {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid quota value "${raw}". Use a non-negative integer or "unlimited".`);
  }

  return parsed;
}

function parseTier(raw: string | undefined): Tier {
  const value = (raw || "free").trim().toLowerCase();
  if (value === "free" || value === "starter" || value === "enterprise") {
    return value;
  }
  throw new Error(`Invalid tier "${raw}". Expected free|starter|enterprise.`);
}

function parseMetadata(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid metadata JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Metadata must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function parseOptions(argv: string[]): CliOptions | null {
  let name: string | undefined;
  let tierRaw: string | undefined;
  let dailyQuotaRaw: string | undefined;
  let minuteQuotaRaw: string | undefined;
  let apiKey: string | undefined;
  let metadataRaw: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    if (current === "--help" || current === "-h") {
      return null;
    }

    if (!current.startsWith("--")) {
      throw new Error(`Unexpected argument "${current}".\n\n${usage()}`);
    }

    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${current}.\n\n${usage()}`);
    }

    switch (current) {
      case "--name":
        name = next.trim();
        break;
      case "--tier":
        tierRaw = next;
        break;
      case "--daily-quota":
        dailyQuotaRaw = next;
        break;
      case "--minute-quota":
        minuteQuotaRaw = next;
        break;
      case "--key":
        apiKey = next.trim();
        break;
      case "--metadata":
        metadataRaw = next;
        break;
      default:
        throw new Error(`Unknown option "${current}".\n\n${usage()}`);
    }

    i += 1;
  }

  const tier = parseTier(tierRaw);
  const dailyQuota = parseQuota(dailyQuotaRaw, 100);
  const minuteQuota = parseQuota(minuteQuotaRaw, 20);
  const createdKey = apiKey && apiKey.length > 0
    ? apiKey
    : `nlt_${randomBytes(24).toString("base64url")}`;

  if (createdKey.length < 16) {
    throw new Error("API key must be at least 16 characters.");
  }

  return {
    name: name || `nightlife-${tier}-${Date.now()}`,
    tier,
    dailyQuota,
    minuteQuota,
    apiKey: createdKey,
    metadata: parseMetadata(metadataRaw),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    console.log(usage());
    return;
  }
  const config = loadConfig();
  const supabase = createSupabaseClient(config);
  const keyHash = hashApiKey(options.apiKey);
  const keyPrefix = options.apiKey.slice(0, 10);

  const { data, error } = await supabase
    .from("mcp_api_keys")
    .insert({
      key_name: options.name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      tier: options.tier,
      status: "active",
      daily_quota: options.dailyQuota,
      per_minute_quota: options.minuteQuota,
      metadata: options.metadata,
    })
    .select("id,key_name,tier,status,daily_quota,per_minute_quota,created_at")
    .single();

  if (error) {
    throw new Error(`Failed to create API key: ${error.message}`);
  }

  console.log("API key created.");
  console.log(`id: ${data.id}`);
  console.log(`name: ${data.key_name}`);
  console.log(`tier: ${data.tier}`);
  console.log(`status: ${data.status}`);
  console.log(`daily_quota: ${data.daily_quota === null ? "unlimited" : data.daily_quota}`);
  console.log(
    `minute_quota: ${
      data.per_minute_quota === null ? "unlimited" : data.per_minute_quota
    }`,
  );
  console.log(`created_at: ${data.created_at}`);
  console.log(`fingerprint: ${keyFingerprint(options.apiKey)}`);
  console.log(`api_key: ${options.apiKey}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
