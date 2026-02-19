import type { SupabaseClient } from "@supabase/supabase-js";
import type { CityContext } from "../types.js";
import { normalizeCutoffTime } from "../utils/time.js";

const CITY_SELECT =
  "id,slug,name_en,timezone,service_day_cutoff_time,country_code";

type CityRow = {
  id: string;
  slug: string;
  name_en: string;
  timezone: string;
  service_day_cutoff_time: string;
  country_code: string;
};

function toCityContext(row: CityRow): CityContext {
  return {
    id: row.id,
    slug: row.slug,
    nameEn: row.name_en,
    timezone: row.timezone || "UTC",
    serviceDayCutoffTime: normalizeCutoffTime(row.service_day_cutoff_time),
    countryCode: row.country_code || "JP",
  };
}

export async function getCityContext(
  supabase: SupabaseClient,
  citySlug: string,
  defaultCountryCode: string,
): Promise<CityContext | null> {
  const normalizedSlug = citySlug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  const strict = await supabase
    .from("cities")
    .select(CITY_SELECT)
    .eq("slug", normalizedSlug)
    .eq("country_code", defaultCountryCode)
    .limit(1)
    .maybeSingle<CityRow>();

  if (strict.data) {
    return toCityContext(strict.data);
  }

  const loose = await supabase
    .from("cities")
    .select(CITY_SELECT)
    .eq("slug", normalizedSlug)
    .limit(1)
    .maybeSingle<CityRow>();

  if (loose.data) {
    return toCityContext(loose.data);
  }

  return null;
}

export async function listAvailableCities(
  supabase: SupabaseClient,
  topLevelCities?: string[],
): Promise<string[]> {
  const { data, error } = await supabase
    .from("cities")
    .select("slug")
    .order("slug", { ascending: true });

  if (error || !data) {
    return [];
  }

  const normalized = data
    .map((row) => String(row.slug || "").trim().toLowerCase())
    .filter((value) => value.length > 0 && !value.startsWith("unknown"));

  if (!topLevelCities || topLevelCities.length === 0) {
    return normalized;
  }

  const allowed = new Set(
    topLevelCities
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );

  return normalized.filter((slug) => allowed.has(slug));
}
