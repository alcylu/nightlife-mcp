import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import type {
  CityUnavailable,
  EventSummary,
  PerformerDetail,
  PerformerSummary,
  PerformerUpcomingEvent,
  SearchPerformersOutput,
} from "../types.js";
import { NightlifeError } from "../errors.js";
import { getCityContext, listAvailableCities } from "./cities.js";
import {
  addDaysToIsoDate,
  getCurrentServiceDate,
  parseDateFilter,
  serviceDateWindowToUtc,
} from "../utils/time.js";

type SearchPerformersInput = {
  city?: string;
  date?: string;
  genre?: string;
  query?: string;
  sort_by?: "popularity" | "recent_activity" | "alphabetical" | "rising_stars";
  limit?: number;
  offset?: number;
};

type EventOccurrenceRow = {
  id: string;
  city_id: string | null;
  venue_id: string | null;
  name_en: string | null;
  name_i18n: unknown;
  description_en: string | null;
  description_i18n: unknown;
  entrance_costs: unknown;
  start_at: string | null;
  published: boolean;
  occurrence_days: Array<{
    id: string;
    service_date: string;
    start_at: string | null;
    end_at: string | null;
    published: boolean;
    title_en_override: string | null;
    title_i18n_override: unknown;
  }> | null;
  venue:
    | {
        id: string;
        name: string | null;
        name_en: string | null;
        name_ja: string | null;
        address: string | null;
        address_en: string | null;
        address_ja: string | null;
        city: string | null;
        city_en: string | null;
        city_ja: string | null;
        website: string | null;
      }
    | Array<{
        id: string;
        name: string | null;
        name_en: string | null;
        name_ja: string | null;
        address: string | null;
        address_en: string | null;
        address_ja: string | null;
        city: string | null;
        city_en: string | null;
        city_ja: string | null;
        website: string | null;
      }>
    | null;
};

type PerformerRow = {
  id: string;
  name: string;
  name_en: string | null;
  name_ja: string | null;
  slug: string | null;
  bio: string | null;
  bio_en: string | null;
  follower_count: number | null;
  ranking_score: number | null;
  is_hot_rising_star: boolean | null;
};

type GenreRow = {
  performer_id: string;
  genre:
    | {
        name: string | null;
        name_en: string | null;
        name_ja: string | null;
      }
    | Array<{
        name: string | null;
        name_en: string | null;
        name_ja: string | null;
      }>
    | null;
};

type PerformerMediaRow = {
  performer_id: string;
  media_url: string;
  is_primary: boolean;
  display_order: number;
};

type EventStageRow = {
  id: string;
  event_id: string;
  custom_name: string | null;
  venue_stage: { name: string | null } | Array<{ name: string | null }> | null;
};

type EventTimetableRow = {
  performer_id: string;
  event_stage_id: string;
  start_time: string | null;
  end_time: string | null;
};

type SocialLinkRow = {
  username: string;
  full_url: string | null;
  platform:
    | {
        name: string | null;
      }
    | Array<{
        name: string | null;
      }>
    | null;
};

type CityRow = {
  id: string;
  slug: string;
  country_code: string;
};

type MediaRow = {
  event_id: string;
  media_type: string;
  media_url: string;
  is_primary: boolean;
  display_order: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OCCURRENCE_SELECT =
  "id,city_id,venue_id,name_en,name_i18n,description_en,description_i18n,entrance_costs,start_at,published,occurrence_days:event_occurrence_days(id,service_date,start_at,end_at,published,title_en_override,title_i18n_override),venue:venues(id,name,name_en,name_ja,address,address_en,address_ja,city,city_en,city_ja,website)";

function normalizeCity(value: string | undefined, fallback: string): string {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized || fallback;
}

function coerceLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return 10;
  }
  return Math.min(20, Math.max(1, Math.floor(limit ?? 10)));
}

function coerceOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(0, Math.floor(offset ?? 0));
}

function normalizeSortBy(
  value: SearchPerformersInput["sort_by"],
): "popularity" | "recent_activity" | "alphabetical" | "rising_stars" {
  if (value === "recent_activity") {
    return value;
  }
  if (value === "alphabetical") {
    return value;
  }
  if (value === "rising_stars") {
    return value;
  }
  return "popularity";
}

function sanitizeIlike(value: string): string {
  return value.replace(/[,()]/g, "").trim();
}

function maybeJa(i18n: unknown): string | null {
  if (!i18n || typeof i18n !== "object") {
    return null;
  }
  const maybe = (i18n as { ja?: unknown }).ja;
  if (typeof maybe !== "string") {
    return null;
  }
  const trimmed = maybe.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }
  return Array.isArray(value) ? value[0] || null : value;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function hasNeedle(needle: string, ...values: Array<string | null | undefined>): boolean {
  return values.some((value) => String(value || "").toLowerCase().includes(needle));
}

function primaryDay(
  days: EventOccurrenceRow["occurrence_days"],
): NonNullable<EventOccurrenceRow["occurrence_days"]>[number] | null {
  if (!days || days.length === 0) {
    return null;
  }
  const published = days.filter((day) => day.published !== false);
  const candidates = published.length > 0 ? published : days;
  return [...candidates].sort((a, b) => {
    const aKey = `${a.service_date}|${a.start_at || ""}`;
    const bKey = `${b.service_date}|${b.start_at || ""}`;
    return aKey.localeCompare(bKey);
  })[0];
}

function eventName(row: EventOccurrenceRow): string {
  const day = primaryDay(row.occurrence_days);
  const dayJa = maybeJa(day?.title_i18n_override);
  const occurrenceJa = maybeJa(row.name_i18n);
  return (
    day?.title_en_override ||
    row.name_en ||
    dayJa ||
    occurrenceJa ||
    "Untitled Event"
  );
}

function venueName(venue: EventOccurrenceRow["venue"]): string {
  const v = firstRelation(venue);
  if (!v) {
    return "Unknown Venue";
  }
  return v.name_en || v.name || v.name_ja || "Unknown Venue";
}

function venueArea(venue: EventOccurrenceRow["venue"]): string | null {
  const v = firstRelation(venue);
  if (!v) {
    return null;
  }
  return v.city_en || v.city || v.city_ja || null;
}

function defaultCurrencyForCountry(countryCode?: string | null): string {
  const code = String(countryCode || "").trim().toUpperCase();
  if (code === "US") return "USD";
  if (code === "TH") return "THB";
  return "JPY";
}

function summarizeEntranceCosts(raw: unknown, fallbackCurrency = "JPY"): string | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const values: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) {
        values.push(text);
      }
      continue;
    }

    if (typeof item === "number" && Number.isFinite(item)) {
      values.push(`${fallbackCurrency} ${Math.round(item)}`);
      continue;
    }

    if (!item || typeof item !== "object") {
      continue;
    }

    const obj = item as Record<string, unknown>;
    const label = [obj.label, obj.name, obj.tier_name, obj.type].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );

    const currency =
      typeof obj.currency === "string" && obj.currency.trim().length > 0
        ? obj.currency.trim().toUpperCase()
        : fallbackCurrency;

    const amount = [obj.price, obj.amount, obj.cost, obj.value].find(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) as number | undefined;

    if (amount !== undefined) {
      const price = `${currency} ${Math.round(amount)}`;
      values.push(label ? `${label}: ${price}` : price);
    } else if (label) {
      values.push(label);
    }
  }

  if (values.length === 0) {
    return null;
  }
  return values.slice(0, 2).join(" | ");
}

function buildEventUrl(baseUrl: string, citySlug: string, eventId: string): string {
  return `${baseUrl}/en/${citySlug}/events/${eventId}`;
}

function buildPerformerUrl(baseUrl: string, citySlug: string, slugOrId: string): string {
  return `${baseUrl}/en/${citySlug}/djs/${slugOrId}`;
}

async function unavailableCityPayload(
  supabase: SupabaseClient,
  requestedCity: string,
  baseUrl: string,
  topLevelCities: string[],
): Promise<CityUnavailable> {
  const available = await listAvailableCities(supabase, topLevelCities);
  return {
    requested_city: requestedCity,
    message: `${requestedCity} is not available yet.`,
    available_cities: available,
    request_city_url: `${baseUrl}/request-city`,
  };
}

async function fetchGenresByPerformer(
  supabase: SupabaseClient,
  performerIds: string[],
): Promise<Map<string, string[]>> {
  const genresByPerformer = new Map<string, string[]>();
  if (performerIds.length === 0) {
    return genresByPerformer;
  }

  for (const idsChunk of chunkArray(performerIds, 100)) {
    const { data, error } = await supabase
      .from("performer_genres")
      .select("performer_id,genre:genres(name,name_en,name_ja)")
      .in("performer_id", idsChunk);

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch performer genres.", {
        cause: error.message,
      });
    }

    for (const row of (data || []) as unknown as GenreRow[]) {
      const genre = firstRelation(row.genre);
      if (!genre) {
        continue;
      }
      const name = genre.name_en || genre.name || genre.name_ja;
      if (!name) {
        continue;
      }
      const existing = genresByPerformer.get(row.performer_id) || [];
      if (!existing.includes(name)) {
        existing.push(name);
        genresByPerformer.set(row.performer_id, existing);
      }
    }
  }

  return genresByPerformer;
}

async function fetchPrimaryImagesByPerformer(
  supabase: SupabaseClient,
  performerIds: string[],
): Promise<Map<string, string>> {
  const imageByPerformer = new Map<string, string>();
  if (performerIds.length === 0) {
    return imageByPerformer;
  }

  for (const idsChunk of chunkArray(performerIds, 100)) {
    const { data, error } = await supabase
      .from("performer_media")
      .select("performer_id,media_url,is_primary,display_order")
      .in("performer_id", idsChunk)
      .order("is_primary", { ascending: false })
      .order("display_order", { ascending: true });

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch performer media.", {
        cause: error.message,
      });
    }

    for (const row of (data || []) as unknown as PerformerMediaRow[]) {
      if (!imageByPerformer.has(row.performer_id) && row.media_url) {
        imageByPerformer.set(row.performer_id, row.media_url);
      }
    }
  }

  return imageByPerformer;
}

async function resolveGenrePerformerIds(
  supabase: SupabaseClient,
  performerIds: string[],
  genreInput: string,
): Promise<Set<string>> {
  const needle = sanitizeIlike(genreInput).toLowerCase();
  if (!needle || performerIds.length === 0) {
    return new Set();
  }

  const matches = new Set<string>();
  for (const idsChunk of chunkArray(performerIds, 100)) {
    const { data, error } = await supabase
      .from("performer_genres")
      .select("performer_id,genre:genres(name,name_en,name_ja)")
      .in("performer_id", idsChunk);

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to resolve genre filters.", {
        cause: error.message,
      });
    }

    for (const row of (data || []) as unknown as GenreRow[]) {
      const genre = firstRelation(row.genre);
      if (!genre) {
        continue;
      }
      if (hasNeedle(needle, genre.name, genre.name_en, genre.name_ja)) {
        matches.add(row.performer_id);
      }
    }
  }

  return matches;
}

async function fetchOccurrenceMetadata(
  supabase: SupabaseClient,
  occurrenceIds: string[],
): Promise<{
  genresByEvent: Map<string, string[]>;
  mediaByEvent: Map<string, MediaRow[]>;
  performersByEvent: Map<string, string[]>;
}> {
  const genresByEvent = new Map<string, string[]>();
  const mediaByEvent = new Map<string, MediaRow[]>();
  const performersByEvent = new Map<string, string[]>();

  if (occurrenceIds.length === 0) {
    return { genresByEvent, mediaByEvent, performersByEvent };
  }

  for (const idsChunk of chunkArray(occurrenceIds, 100)) {
    const [genreResult, mediaResult, stageResult] = await Promise.all([
      supabase
        .from("event_genres")
        .select("event_id,genre:genres(name,name_en,name_ja)")
        .in("event_id", idsChunk),
      supabase
        .from("event_media")
        .select("event_id,media_type,media_url,is_primary,display_order")
        .in("event_id", idsChunk)
        .in("media_type", ["flyer", "cover"])
        .order("is_primary", { ascending: false })
        .order("display_order", { ascending: true }),
      supabase
        .from("event_stages")
        .select(
          "event_id,event_timetables(performer:performers(name,name_en,name_ja))",
        )
        .in("event_id", idsChunk),
    ]);

    if (genreResult.error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch event genres.", {
        cause: genreResult.error.message,
      });
    }
    if (mediaResult.error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch event media.", {
        cause: mediaResult.error.message,
      });
    }
    if (stageResult.error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch event lineup.", {
        cause: stageResult.error.message,
      });
    }

    for (const row of (genreResult.data || []) as unknown as Array<{
      event_id: string;
      genre:
        | { name: string | null; name_en: string | null; name_ja: string | null }
        | Array<{ name: string | null; name_en: string | null; name_ja: string | null }>
        | null;
    }>) {
      const genre = firstRelation(row.genre);
      const name = genre?.name_en || genre?.name || genre?.name_ja;
      if (!name) {
        continue;
      }
      const existing = genresByEvent.get(row.event_id) || [];
      if (!existing.includes(name)) {
        existing.push(name);
        genresByEvent.set(row.event_id, existing);
      }
    }

    for (const row of (mediaResult.data || []) as unknown as MediaRow[]) {
      const list = mediaByEvent.get(row.event_id) || [];
      list.push(row);
      mediaByEvent.set(row.event_id, list);
    }

    for (const row of (stageResult.data || []) as unknown as Array<{
      event_id: string;
      event_timetables: Array<{
        performer:
          | { name: string | null; name_en: string | null; name_ja: string | null }
          | Array<{ name: string | null; name_en: string | null; name_ja: string | null }>
          | null;
      }> | null;
    }>) {
      const names = new Set(performersByEvent.get(row.event_id) || []);
      for (const slot of row.event_timetables || []) {
        const performer = firstRelation(slot.performer);
        const name = performer?.name_en || performer?.name || performer?.name_ja;
        if (name) {
          names.add(name);
        }
      }
      performersByEvent.set(row.event_id, Array.from(names));
    }
  }

  for (const [eventId, rows] of mediaByEvent.entries()) {
    rows.sort((a, b) => {
      if (a.is_primary !== b.is_primary) {
        return Number(b.is_primary) - Number(a.is_primary);
      }
      return a.display_order - b.display_order;
    });
    mediaByEvent.set(eventId, rows);
  }

  return { genresByEvent, mediaByEvent, performersByEvent };
}

function toEventSummary(
  row: EventOccurrenceRow,
  citySlug: string,
  baseUrl: string,
  fallbackCurrency: string,
  metadata: {
    genresByEvent: Map<string, string[]>;
    mediaByEvent: Map<string, MediaRow[]>;
    performersByEvent: Map<string, string[]>;
  },
): EventSummary {
  const day = primaryDay(row.occurrence_days);
  const flyer = metadata.mediaByEvent.get(row.id)?.[0]?.media_url || null;

  return {
    event_id: row.id,
    name: eventName(row),
    date: day?.start_at || row.start_at || "",
    service_date: day?.service_date || null,
    venue: {
      id: firstRelation(row.venue)?.id || row.venue_id || "",
      name: venueName(row.venue),
      area: venueArea(row.venue),
    },
    performers: metadata.performersByEvent.get(row.id) || [],
    genres: metadata.genresByEvent.get(row.id) || [],
    price: summarizeEntranceCosts(row.entrance_costs, fallbackCurrency),
    flyer_url: flyer,
    nlt_url: buildEventUrl(baseUrl, citySlug, row.id),
  };
}

function sortPerformerSummaries(
  performers: PerformerSummary[],
  sortBy: "popularity" | "recent_activity" | "alphabetical" | "rising_stars",
): PerformerSummary[] {
  return [...performers].sort((a, b) => {
    if (sortBy === "alphabetical") {
      return a.name.localeCompare(b.name);
    }

    if (sortBy === "recent_activity") {
      const aDate = a.next_event_date || "9999";
      const bDate = b.next_event_date || "9999";
      if (aDate !== bDate) {
        return aDate.localeCompare(bDate);
      }
      return (b.follower_count || 0) - (a.follower_count || 0);
    }

    if (sortBy === "rising_stars") {
      const aHot = Number(a.ranking_score !== null && a.ranking_score >= 70);
      const bHot = Number(b.ranking_score !== null && b.ranking_score >= 70);
      if (aHot !== bHot) {
        return bHot - aHot;
      }
      if ((b.ranking_score || 0) !== (a.ranking_score || 0)) {
        return (b.ranking_score || 0) - (a.ranking_score || 0);
      }
      return (b.follower_count || 0) - (a.follower_count || 0);
    }

    if ((b.ranking_score || 0) !== (a.ranking_score || 0)) {
      return (b.ranking_score || 0) - (a.ranking_score || 0);
    }
    if ((b.follower_count || 0) !== (a.follower_count || 0)) {
      return (b.follower_count || 0) - (a.follower_count || 0);
    }
    return a.name.localeCompare(b.name);
  });
}

export const __testOnly_sortPerformerSummaries = sortPerformerSummaries;

function matchPerformerQuery(
  name: string,
  genres: string[],
  queryNeedle: string,
): boolean {
  if (!queryNeedle) return true;
  if (name.toLowerCase().includes(queryNeedle)) return true;
  return genres.some((genre) => genre.toLowerCase().includes(queryNeedle));
}

export const __testOnly_matchPerformerQuery = matchPerformerQuery;

export async function searchPerformers(
  supabase: SupabaseClient,
  config: AppConfig,
  input: SearchPerformersInput,
): Promise<SearchPerformersOutput> {
  const citySlug = normalizeCity(input.city, config.defaultCity);
  const city = await getCityContext(supabase, citySlug, config.defaultCountryCode);

  if (!city) {
    return {
      city: citySlug,
      date_filter: input.date || null,
      performers: [],
      unavailable_city: await unavailableCityPayload(
        supabase,
        citySlug,
        config.nightlifeBaseUrl,
        config.topLevelCities,
      ),
    };
  }

  const now = new Date();
  let parsedDate: ReturnType<typeof parseDateFilter>;
  try {
    parsedDate = parseDateFilter(input.date, now, city.timezone, city.serviceDayCutoffTime);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid date filter.";
    throw new NightlifeError("INVALID_DATE_FILTER", message);
  }

  const currentServiceDate = getCurrentServiceDate(now, city.timezone, city.serviceDayCutoffTime);
  const startServiceDate = parsedDate?.startServiceDate || currentServiceDate;
  const endServiceDateExclusive =
    parsedDate?.endServiceDateExclusive || addDaysToIsoDate(currentServiceDate, 31);
  const window = serviceDateWindowToUtc(
    startServiceDate,
    endServiceDateExclusive,
    city.timezone,
    city.serviceDayCutoffTime,
  );

  const { data: occurrenceRows, error: occurrenceError } = await supabase
    .from("event_occurrences")
    .select("id,start_at,occurrence_days:event_occurrence_days(id,service_date,start_at,end_at,published,title_en_override,title_i18n_override)")
    .eq("published", true)
    .eq("city_id", city.id)
    .gte("start_at", window.startIso)
    .lt("start_at", window.endIso)
    .order("start_at", { ascending: true })
    .range(0, 1999);

  if (occurrenceError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch city events.", {
      cause: occurrenceError.message,
    });
  }

  const occurrences = (occurrenceRows || []) as unknown as Array<{
    id: string;
    start_at: string | null;
    occurrence_days: EventOccurrenceRow["occurrence_days"];
  }>;

  if (occurrences.length === 0) {
    return {
      city: city.slug,
      date_filter: parsedDate?.label || null,
      performers: [],
      unavailable_city: null,
    };
  }

  const eventIds = occurrences.map((row) => row.id);
  const occurrenceDateById = new Map<string, string | null>();
  for (const row of occurrences) {
    occurrenceDateById.set(row.id, primaryDay(row.occurrence_days)?.start_at || row.start_at || null);
  }

  const stageRows: EventStageRow[] = [];
  for (const idsChunk of chunkArray(eventIds, 100)) {
    const { data, error } = await supabase
      .from("event_stages")
      .select("id,event_id,custom_name,venue_stage:venue_stages(name)")
      .in("event_id", idsChunk);

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch event stages.", {
        cause: error.message,
      });
    }

    stageRows.push(...((data || []) as unknown as EventStageRow[]));
  }

  const stageById = new Map<string, EventStageRow>();
  for (const stage of stageRows) {
    stageById.set(stage.id, stage);
  }

  if (stageById.size === 0) {
    return {
      city: city.slug,
      date_filter: parsedDate?.label || null,
      performers: [],
      unavailable_city: null,
    };
  }

  const performerSlots: EventTimetableRow[] = [];
  for (const idsChunk of chunkArray(Array.from(stageById.keys()), 100)) {
    const { data, error } = await supabase
      .from("event_timetables")
      .select("performer_id,event_stage_id,start_time,end_time")
      .in("event_stage_id", idsChunk);

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch performer slots.", {
        cause: error.message,
      });
    }

    performerSlots.push(...((data || []) as unknown as EventTimetableRow[]));
  }

  const nextEventByPerformer = new Map<string, string | null>();
  const performerIdSet = new Set<string>();

  for (const slot of performerSlots) {
    if (!slot.performer_id) {
      continue;
    }
    const stage = stageById.get(slot.event_stage_id);
    if (!stage) {
      continue;
    }
    const date = occurrenceDateById.get(stage.event_id) || null;
    performerIdSet.add(slot.performer_id);
    const previous = nextEventByPerformer.get(slot.performer_id);
    if (!previous || (date && date < previous)) {
      nextEventByPerformer.set(slot.performer_id, date);
    }
  }

  let performerIds = Array.from(performerIdSet);
  if (input.genre) {
    const genreMatches = await resolveGenrePerformerIds(supabase, performerIds, input.genre);
    performerIds = performerIds.filter((id) => genreMatches.has(id));
  }

  if (performerIds.length === 0) {
    return {
      city: city.slug,
      date_filter: parsedDate?.label || null,
      performers: [],
      unavailable_city: null,
    };
  }

  const performerRows: PerformerRow[] = [];
  for (const idsChunk of chunkArray(performerIds, 100)) {
    const { data, error } = await supabase
      .from("performers")
      .select("id,name,name_en,name_ja,slug,bio,bio_en,follower_count,ranking_score,is_hot_rising_star")
      .in("id", idsChunk);

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch performers.", {
        cause: error.message,
      });
    }

    performerRows.push(...((data || []) as unknown as PerformerRow[]));
  }

  const genresByPerformer = await fetchGenresByPerformer(
    supabase,
    performerRows.map((row) => row.id),
  );
  const imageByPerformer = await fetchPrimaryImagesByPerformer(
    supabase,
    performerRows.map((row) => row.id),
  );

  const queryNeedle = input.query ? sanitizeIlike(input.query).toLowerCase() : "";

  const summaries: PerformerSummary[] = performerRows
    .map((row) => {
      const genres = genresByPerformer.get(row.id) || [];
      const name = row.name_en || row.name || row.name_ja || "Unknown Performer";
      return {
        performer_id: row.id,
        name,
        slug: row.slug || null,
        follower_count: row.follower_count,
        ranking_score: row.ranking_score,
        genres,
        image_url: imageByPerformer.get(row.id) || null,
        has_upcoming_event: Boolean(nextEventByPerformer.get(row.id)),
        next_event_date: nextEventByPerformer.get(row.id) || null,
        nlt_url: buildPerformerUrl(
          config.nightlifeBaseUrl,
          city.slug,
          row.slug || row.id,
        ),
      };
    })
    .filter((summary) => matchPerformerQuery(summary.name, summary.genres, queryNeedle));

  const sorted = sortPerformerSummaries(summaries, normalizeSortBy(input.sort_by));
  const offset = coerceOffset(input.offset);
  const limit = coerceLimit(input.limit);

  return {
    city: city.slug,
    date_filter: parsedDate?.label || null,
    performers: sorted.slice(offset, offset + limit),
    unavailable_city: null,
  };
}

export async function getPerformerInfo(
  supabase: SupabaseClient,
  config: AppConfig,
  performerId: string,
): Promise<PerformerDetail | null> {
  const cleanedId = performerId.trim();
  if (!cleanedId) {
    throw new NightlifeError("INVALID_PERFORMER_ID", "performer_id cannot be blank.");
  }
  if (!UUID_RE.test(cleanedId)) {
    throw new NightlifeError("INVALID_PERFORMER_ID", "performer_id must be a UUID.");
  }

  const { data: performer, error: performerError } = await supabase
    .from("performers")
    .select("id,name,name_en,name_ja,slug,bio,bio_en,follower_count,ranking_score,is_hot_rising_star")
    .eq("id", cleanedId)
    .maybeSingle<PerformerRow>();

  if (performerError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch performer details.", {
      cause: performerError.message,
    });
  }
  if (!performer) {
    return null;
  }

  const genresByPerformer = await fetchGenresByPerformer(supabase, [performer.id]);
  const imageByPerformer = await fetchPrimaryImagesByPerformer(supabase, [performer.id]);

  const { data: socialRows, error: socialError } = await supabase
    .from("performer_social_links")
    .select("username,full_url,platform:social_media_platforms(name)")
    .eq("performer_id", performer.id);

  if (socialError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch performer social links.", {
      cause: socialError.message,
    });
  }

  const socialLinks = ((socialRows || []) as unknown as SocialLinkRow[])
    .map((row) => {
      const platform = firstRelation(row.platform);
      return {
        platform: platform?.name || "unknown",
        username: row.username,
        url: row.full_url || null,
      };
    })
    .sort((a, b) => a.platform.localeCompare(b.platform));

  const { data: timetableRows, error: timetableError } = await supabase
    .from("event_timetables")
    .select("event_stage_id,start_time,end_time")
    .eq("performer_id", performer.id);

  if (timetableError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch performer timetable slots.", {
      cause: timetableError.message,
    });
  }

  const timetableSlots = (timetableRows || []) as Array<{
    event_stage_id: string;
    start_time: string | null;
    end_time: string | null;
  }>;

  if (timetableSlots.length === 0) {
    const defaultCity = config.defaultCity;
    return {
      performer_id: performer.id,
      name: performer.name_en || performer.name || performer.name_ja || "Unknown Performer",
      slug: performer.slug,
      bio: performer.bio_en || performer.bio || null,
      follower_count: performer.follower_count,
      ranking_score: performer.ranking_score,
      genres: genresByPerformer.get(performer.id) || [],
      image_url: imageByPerformer.get(performer.id) || null,
      social_links: socialLinks,
      upcoming_events: [],
      nlt_url: buildPerformerUrl(config.nightlifeBaseUrl, defaultCity, performer.slug || performer.id),
    };
  }

  const stageIds = Array.from(new Set(timetableSlots.map((row) => row.event_stage_id)));
  const stageRows: EventStageRow[] = [];

  for (const idsChunk of chunkArray(stageIds, 100)) {
    const { data, error } = await supabase
      .from("event_stages")
      .select("id,event_id,custom_name,venue_stage:venue_stages(name)")
      .in("id", idsChunk);

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch performer stages.", {
        cause: error.message,
      });
    }

    stageRows.push(...((data || []) as unknown as EventStageRow[]));
  }

  const stageById = new Map<string, EventStageRow>();
  for (const stage of stageRows) {
    stageById.set(stage.id, stage);
  }

  const eventIds = Array.from(
    new Set(
      timetableSlots
        .map((slot) => stageById.get(slot.event_stage_id)?.event_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const { data: occurrenceRows, error: occurrenceError } = await supabase
    .from("event_occurrences")
    .select(OCCURRENCE_SELECT)
    .in("id", eventIds)
    .eq("published", true)
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true });

  if (occurrenceError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch performer events.", {
      cause: occurrenceError.message,
    });
  }

  const occurrences = (occurrenceRows || []) as unknown as EventOccurrenceRow[];
  const occurrenceById = new Map<string, EventOccurrenceRow>();
  for (const row of occurrences) {
    occurrenceById.set(row.id, row);
  }

  const cityIds = Array.from(
    new Set(occurrences.map((row) => row.city_id).filter((value): value is string => Boolean(value))),
  );
  const cityById = new Map<string, CityRow>();
  if (cityIds.length > 0) {
    const { data: cityRows, error: cityError } = await supabase
      .from("cities")
      .select("id,slug,country_code")
      .in("id", cityIds);

    if (cityError) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch city metadata.", {
        cause: cityError.message,
      });
    }

    for (const row of (cityRows || []) as unknown as CityRow[]) {
      cityById.set(row.id, row);
    }
  }

  const metadata = await fetchOccurrenceMetadata(
    supabase,
    occurrences.map((row) => row.id),
  );

  const upcomingByEvent = new Map<string, PerformerUpcomingEvent>();
  let firstUpcomingCitySlug: string | null = null;
  for (const slot of timetableSlots) {
    const stage = stageById.get(slot.event_stage_id);
    if (!stage) {
      continue;
    }

    const occurrence = occurrenceById.get(stage.event_id);
    if (!occurrence) {
      continue;
    }

    const cityRow = occurrence.city_id ? cityById.get(occurrence.city_id) : null;
    const citySlug = cityRow?.slug?.toLowerCase() || config.defaultCity;
    if (!firstUpcomingCitySlug) {
      firstUpcomingCitySlug = citySlug;
    }
    const fallbackCurrency = defaultCurrencyForCountry(cityRow?.country_code || config.defaultCountryCode);

    const eventSummary = toEventSummary(
      occurrence,
      citySlug,
      config.nightlifeBaseUrl,
      fallbackCurrency,
      metadata,
    );

    const stageRef = firstRelation(stage.venue_stage);
    const stageName = stage.custom_name || stageRef?.name || null;

    const current = upcomingByEvent.get(eventSummary.event_id);
    if (!current) {
      upcomingByEvent.set(eventSummary.event_id, {
        event: eventSummary,
        stage: stageName,
        set_start_time: slot.start_time || null,
        set_end_time: slot.end_time || null,
      });
      continue;
    }

    const currentStart = current.set_start_time || "99:99:99";
    const candidateStart = slot.start_time || "99:99:99";
    if (candidateStart < currentStart) {
      upcomingByEvent.set(eventSummary.event_id, {
        event: eventSummary,
        stage: stageName,
        set_start_time: slot.start_time || null,
        set_end_time: slot.end_time || null,
      });
    }
  }

  const upcomingEvents = Array.from(upcomingByEvent.values())
    .sort((a, b) => a.event.date.localeCompare(b.event.date))
    .slice(0, 10);

  const detailCitySlug = (firstUpcomingCitySlug || config.defaultCity).toLowerCase();

  return {
    performer_id: performer.id,
    name: performer.name_en || performer.name || performer.name_ja || "Unknown Performer",
    slug: performer.slug,
    bio: performer.bio_en || performer.bio || null,
    follower_count: performer.follower_count,
    ranking_score: performer.ranking_score,
    genres: genresByPerformer.get(performer.id) || [],
    image_url: imageByPerformer.get(performer.id) || null,
    social_links: socialLinks,
    upcoming_events: upcomingEvents,
    nlt_url: buildPerformerUrl(
      config.nightlifeBaseUrl,
      detailCitySlug,
      performer.slug || performer.id,
    ),
  };
}
