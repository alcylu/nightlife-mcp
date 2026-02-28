import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnmetRequestResult } from "../types.js";
import { NightlifeError } from "../errors.js";

export type LogUnmetRequestInput = {
  channel?: string;
  language?: string;
  city?: string;
  raw_query: string;
  intent?: string;
  suggested_filters?: Record<string, unknown>;
  user_hash?: string;
};

type UnmetRequestRow = {
  id: string;
  status: string;
  created_at: string;
};

function normalizeChannel(value: string | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (["line", "discord", "whatsapp", "web", "api"].includes(normalized)) {
    return normalized;
  }
  return "other";
}

function normalizeLanguage(value: string | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  return normalized.replace(/[^a-z0-9_-]/g, "").slice(0, 16) || "unknown";
}

function normalizeCity(value: string | undefined): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 80);
}

function normalizeIntent(value: string | undefined): string | null {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 200);
}

function normalizeUserHash(value: string | undefined): string | null {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 128) || null;
}

function normalizeSuggestedFilters(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

export async function logUnmetRequest(
  supabase: SupabaseClient,
  input: LogUnmetRequestInput,
): Promise<UnmetRequestResult> {
  const rawQuery = String(input.raw_query || "").trim();
  if (!rawQuery) {
    throw new NightlifeError("INVALID_REQUEST", "raw_query cannot be blank.");
  }

  const payload = {
    channel: normalizeChannel(input.channel),
    language: normalizeLanguage(input.language),
    city: normalizeCity(input.city),
    raw_query: rawQuery.slice(0, 4000),
    normalized_intent: normalizeIntent(input.intent),
    suggested_filters: normalizeSuggestedFilters(input.suggested_filters),
    user_hash: normalizeUserHash(input.user_hash),
    status: "open",
  };

  const { data, error } = await supabase
    .from("concierge_unmet_requests")
    .insert(payload)
    .select("id,status,created_at")
    .single<UnmetRequestRow>();

  if (error || !data) {
    throw new NightlifeError("REQUEST_WRITE_FAILED", "Failed to log unmet request.", {
      cause: error?.message || "Unknown insert error",
    });
  }

  return {
    request_id: data.id,
    status: data.status,
    created_at: data.created_at,
  };
}
