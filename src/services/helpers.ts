import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { getCityContext } from "./cities.js";
import { NightlifeError } from "../errors.js";

// --- list_genres ---

type GenreRow = {
  id: string;
  name: string;
  name_en: string | null;
  name_ja: string | null;
};

export async function listGenres(
  supabase: SupabaseClient,
): Promise<{ genres: GenreRow[] }> {
  const { data, error } = await supabase
    .from("genres")
    .select("id,name,name_en,name_ja")
    .order("name", { ascending: true });

  if (error) {
    throw new NightlifeError("INTERNAL_ERROR", `Failed to fetch genres: ${error.message}`);
  }

  return { genres: data ?? [] };
}

// --- list_areas ---

type AreaRow = {
  name_en: string;
  name_i18n: unknown;
  sort_order: number | null;
};

export async function listAreas(
  supabase: SupabaseClient,
  config: AppConfig,
  citySlug?: string,
): Promise<{ city: string; areas: string[] }> {
  const slug = citySlug?.trim().toLowerCase() || config.defaultCity;

  const cityCtx = await getCityContext(supabase, slug, config.defaultCountryCode);
  if (!cityCtx) {
    throw new NightlifeError("INVALID_REQUEST", `City not found: ${slug}`);
  }

  const { data, error } = await supabase
    .from("areas")
    .select("name_en,name_i18n,sort_order")
    .eq("city_id", cityCtx.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name_en", { ascending: true });

  if (error) {
    throw new NightlifeError("INTERNAL_ERROR", `Failed to fetch areas: ${error.message}`);
  }

  const seen = new Set<string>();
  const areas: string[] = [];

  for (const row of (data ?? []) as AreaRow[]) {
    const ja =
      row.name_i18n && typeof row.name_i18n === "object"
        ? (row.name_i18n as { ja?: unknown }).ja
        : null;
    const raw = row.name_en || (typeof ja === "string" ? ja : null);
    if (!raw) continue;
    const normalized = raw.trim().toLowerCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      areas.push(raw.trim());
    }
  }

  areas.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  return { city: cityCtx.slug, areas };
}
