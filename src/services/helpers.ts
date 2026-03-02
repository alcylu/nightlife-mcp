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

type VenueAreaRow = {
  city_en: string | null;
  city: string | null;
  city_ja: string | null;
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
    .from("venues")
    .select("city_en,city,city_ja")
    .eq("city_id", cityCtx.id);

  if (error) {
    throw new NightlifeError("INTERNAL_ERROR", `Failed to fetch areas: ${error.message}`);
  }

  const seen = new Set<string>();
  const areas: string[] = [];

  for (const row of (data ?? []) as VenueAreaRow[]) {
    const raw = row.city_en || row.city || row.city_ja;
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
