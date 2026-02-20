import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import type {
  CityUnavailable,
  EventDetail,
  EventSummary,
} from "../types.js";
import { NightlifeError } from "../errors.js";
import { getCityContext, listAvailableCities } from "./cities.js";
import {
  getCurrentServiceDate,
  isCutoffPassedForServiceDate,
  parseDateFilter,
  serviceDateWindowToUtc,
} from "../utils/time.js";

type SearchEventsInput = {
  city?: string;
  date?: string;
  genre?: string;
  area?: string;
  query?: string;
  limit?: number;
  offset?: number;
};

type SearchEventsOutput = {
  city: string;
  date_filter: string | null;
  events: EventSummary[];
  unavailable_city: CityUnavailable | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OCCURRENCE_SELECT =
  "id,city_id,venue_id,name_en,name_i18n,description_en,description_i18n,start_at,end_at,published,featured,source,source_url,entrance_costs,venue:venues(id,name,name_en,name_ja,address,address_en,address_ja,city,city_en,city_ja,website),occurrence_days:event_occurrence_days(id,service_date,start_at,end_at,published,title_en_override,title_i18n_override)";

type EventOccurrenceRow = {
  id: string;
  city_id: string | null;
  venue_id: string | null;
  name_en: string | null;
  name_i18n: unknown;
  description_en: string | null;
  description_i18n: unknown;
  start_at: string | null;
  end_at: string | null;
  published: boolean;
  featured: boolean;
  source: string | null;
  source_url: string | null;
  entrance_costs: unknown;
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
  occurrence_days: Array<{
    id: string;
    service_date: string;
    start_at: string | null;
    end_at: string | null;
    published: boolean;
    title_en_override: string | null;
    title_i18n_override: unknown;
  }> | null;
};

type GenreRow = {
  event_id: string;
  genre:
    | {
        id: string;
        name: string | null;
        name_en: string | null;
        name_ja: string | null;
        is_primary: boolean | null;
      }
    | Array<{
        id: string;
        name: string | null;
        name_en: string | null;
        name_ja: string | null;
        is_primary: boolean | null;
      }>
    | null;
};

type MediaRow = {
  event_id: string;
  media_type: string;
  media_url: string;
  is_primary: boolean;
  display_order: number;
};

type StageRow = {
  event_id: string;
  custom_name: string | null;
  venue_stage: { name: string | null } | Array<{ name: string | null }> | null;
  event_timetables: Array<{
    start_time: string | null;
    end_time: string | null;
    performer:
      | {
          id: string;
          name: string | null;
          name_en: string | null;
          name_ja: string | null;
        }
      | Array<{
          id: string;
          name: string | null;
          name_en: string | null;
          name_ja: string | null;
        }>
      | null;
  }> | null;
};

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

function sanitizeIlike(value: string): string {
  return value.replace(/[,()]/g, "").trim();
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

function buildEventUrl(baseUrl: string, citySlug: string, eventId: string): string {
  return `${baseUrl}/en/${citySlug}/events/${eventId}`;
}

function buildMapLink(address: string | null): string | null {
  if (!address) {
    return null;
  }
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
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
    const label = [
      obj.label,
      obj.name,
      obj.tier_name,
      obj.type,
    ].find((v): v is string => typeof v === "string" && v.trim().length > 0);

    const currency =
      typeof obj.currency === "string" && obj.currency.trim().length > 0
        ? obj.currency.trim().toUpperCase()
        : fallbackCurrency;

    const amountRaw = [obj.price, obj.amount, obj.cost, obj.value].find(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) as number | undefined;

    if (amountRaw !== undefined) {
      const amountLabel = `${currency} ${Math.round(amountRaw)}`;
      values.push(label ? `${label}: ${amountLabel}` : amountLabel);
    } else if (label) {
      values.push(label);
    }
  }

  if (values.length === 0) {
    return null;
  }

  return values.slice(0, 2).join(" | ");
}

function hasNeedle(needle: string, ...haystack: Array<string | null | undefined>): boolean {
  return haystack.some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(needle),
  );
}

async function resolveGenreEventIds(
  supabase: SupabaseClient,
  genreFilter: string,
): Promise<Set<string> | null> {
  const trimmed = genreFilter.trim();
  if (!trimmed) {
    return null;
  }

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed,
    );

  const safe = sanitizeIlike(trimmed);
  const genreQuery = supabase.from("genres").select("id");
  const { data: genres, error: genreError } = isUuid
    ? await genreQuery.eq("id", trimmed)
    : await genreQuery.or(
        `name.ilike.%${safe}%,name_en.ilike.%${safe}%,name_ja.ilike.%${safe}%`,
      );

  if (genreError) {
    throw new NightlifeError(
      "DB_QUERY_FAILED",
      "Failed to fetch genre definitions.",
      { cause: genreError.message },
    );
  }
  if (!genres || genres.length === 0) {
    return new Set<string>();
  }

  const genreIds = genres.map((row) => row.id).filter(Boolean);
  if (genreIds.length === 0) {
    return new Set<string>();
  }

  const eventIds = new Set<string>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data: pageRows, error: pageError } = await supabase
      .from("event_genres")
      .select("event_id")
      .in("genre_id", genreIds)
      .order("event_id", { ascending: true })
      .range(from, to);

    if (pageError) {
      throw new NightlifeError(
        "DB_QUERY_FAILED",
        "Failed to fetch genre mappings.",
        { cause: pageError.message },
      );
    }

    const rows = pageRows || [];
    for (const row of rows) {
      const id = String(row.event_id || "").trim();
      if (id) {
        eventIds.add(id);
      }
    }

    if (rows.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return eventIds;
}

async function fetchOccurrenceMetadata(
  supabase: SupabaseClient,
  occurrenceIds: string[],
): Promise<{
  genresByEvent: Map<string, string[]>;
  mediaByEvent: Map<string, MediaRow[]>;
  performersByEvent: Map<string, string[]>;
  lineupByEvent: Map<
    string,
    Array<{
      stage: string | null;
      performer_name: string;
      start_time: string | null;
      end_time: string | null;
    }>
  >;
}> {
  const uniqueOccurrenceIds = Array.from(
    new Set(occurrenceIds.filter((value) => value.length > 0)),
  );
  if (uniqueOccurrenceIds.length === 0) {
    return {
      genresByEvent: new Map(),
      mediaByEvent: new Map(),
      performersByEvent: new Map(),
      lineupByEvent: new Map(),
    };
  }

  const genreRows: GenreRow[] = [];
  const mediaRows: MediaRow[] = [];
  const stageRows: StageRow[] = [];

  for (const idsChunk of chunkArray(uniqueOccurrenceIds, 100)) {
    const [genreResult, mediaResult, stageResult] = await Promise.all([
      supabase
        .from("event_genres")
        .select(
          "event_id,genre:genres(id,name,name_en,name_ja,is_primary)",
        )
        .in("event_id", idsChunk),
      supabase
        .from("event_media")
        .select("event_id,media_type,media_url,is_primary,display_order")
        .in("event_id", idsChunk)
        .eq("media_type", "image"),
      supabase
        .from("event_stages")
        .select(
          "event_id,custom_name,venue_stage:venue_stages(name),event_timetables(start_time,end_time,performer:performers(id,name,name_en,name_ja))",
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
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch event lineups.", {
        cause: stageResult.error.message,
      });
    }

    genreRows.push(...((genreResult.data || []) as unknown as GenreRow[]));
    mediaRows.push(...((mediaResult.data || []) as MediaRow[]));
    stageRows.push(...((stageResult.data || []) as unknown as StageRow[]));
  }

  const genresByEvent = new Map<string, string[]>();
  for (const row of genreRows) {
    const genre = firstRelation(row.genre);
    if (!row.event_id || !genre) {
      continue;
    }
    const name =
      genre.name_en || genre.name || genre.name_ja || null;
    if (!name) {
      continue;
    }
    const existing = genresByEvent.get(row.event_id) || [];
    if (!existing.includes(name)) {
      existing.push(name);
      genresByEvent.set(row.event_id, existing);
    }
  }

  const mediaByEvent = new Map<string, MediaRow[]>();
  for (const row of mediaRows) {
    if (!row.event_id) {
      continue;
    }
    const existing = mediaByEvent.get(row.event_id) || [];
    existing.push(row);
    mediaByEvent.set(row.event_id, existing);
  }
  for (const [eventId, rows] of mediaByEvent.entries()) {
    rows.sort((a, b) => {
      if (a.is_primary !== b.is_primary) {
        return a.is_primary ? -1 : 1;
      }
      return a.display_order - b.display_order;
    });
    mediaByEvent.set(eventId, rows);
  }

  const performersByEvent = new Map<string, string[]>();
  const lineupByEvent = new Map<
    string,
    Array<{
      stage: string | null;
      performer_name: string;
      start_time: string | null;
      end_time: string | null;
    }>
  >();

  for (const stage of stageRows) {
    if (!stage.event_id || !stage.event_timetables) {
      continue;
    }

    const stageRef = firstRelation(stage.venue_stage);
    const stageName = stage.custom_name || stageRef?.name || null;
    const performerNames = new Set(performersByEvent.get(stage.event_id) || []);
    const lineupRows = lineupByEvent.get(stage.event_id) || [];

    for (const slot of stage.event_timetables) {
      const performer = firstRelation(slot.performer);
      const performerName =
        performer?.name_en ||
        performer?.name ||
        performer?.name_ja ||
        null;
      if (!performerName) {
        continue;
      }
      performerNames.add(performerName);
      lineupRows.push({
        stage: stageName,
        performer_name: performerName,
        start_time: slot.start_time || null,
        end_time: slot.end_time || null,
      });
    }

    performersByEvent.set(stage.event_id, Array.from(performerNames));
    lineupByEvent.set(stage.event_id, lineupRows);
  }

  for (const [eventId, rows] of lineupByEvent.entries()) {
    rows.sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
    lineupByEvent.set(eventId, rows);
  }

  return { genresByEvent, mediaByEvent, performersByEvent, lineupByEvent };
}

async function fetchOccurrencesByIds(
  supabase: SupabaseClient,
  cityId: string,
  eventIds: string[],
  parsedDate: ReturnType<typeof parseDateFilter>,
  timeZone: string,
  cutoffTime: string,
  queryText: string,
): Promise<EventOccurrenceRow[]> {
  const rowsById = new Map<string, EventOccurrenceRow>();

  for (const idsChunk of chunkArray(eventIds, 100)) {
    let query = supabase
      .from("event_occurrences")
      .select(OCCURRENCE_SELECT)
      .eq("published", true)
      .eq("city_id", cityId)
      .in("id", idsChunk)
      .order("start_at", { ascending: true });

    if (parsedDate) {
      const window = serviceDateWindowToUtc(
        parsedDate.startServiceDate,
        parsedDate.endServiceDateExclusive,
        timeZone,
        cutoffTime,
      );
      query = query.gte("start_at", window.startIso).lt("start_at", window.endIso);
    }

    if (queryText) {
      query = query.or(
        `name_en.ilike.%${queryText}%,description_en.ilike.%${queryText}%`,
      );
    }

    const { data, error } = await query;
    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch events.", {
        cause: error.message,
      });
    }

    for (const row of ((data || []) as unknown as EventOccurrenceRow[])) {
      rowsById.set(row.id, row);
    }
  }

  return Array.from(rowsById.values()).sort((a, b) =>
    String(a.start_at || "").localeCompare(String(b.start_at || "")),
  );
}

function matchArea(row: EventOccurrenceRow, area: string): boolean {
  const needle = area.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  const venue = firstRelation(row.venue);
  return hasNeedle(
    needle,
    venue?.city,
    venue?.city_en,
    venue?.city_ja,
    venue?.address,
    venue?.address_en,
    venue?.address_ja,
    venue?.name,
    venue?.name_en,
    venue?.name_ja,
  );
}

function matchQuery(
  row: EventOccurrenceRow,
  query: string,
  performers: string[],
  genres: string[],
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  const venue = firstRelation(row.venue);
  if (
    hasNeedle(
      needle,
      row.name_en,
      maybeJa(row.name_i18n),
      row.description_en,
      maybeJa(row.description_i18n),
      venue?.name,
      venue?.name_en,
      venue?.name_ja,
      venue?.city,
      venue?.city_en,
      venue?.city_ja,
    )
  ) {
    return true;
  }

  return (
    performers.some((name) => name.toLowerCase().includes(needle)) ||
    genres.some((name) => name.toLowerCase().includes(needle))
  );
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
  const venue = firstRelation(row.venue);

  return {
    event_id: row.id,
    name: eventName(row),
    date: day?.start_at || row.start_at || "",
    service_date: day?.service_date || null,
    venue: {
      id: venue?.id || row.venue_id || "",
      name: venueName(venue),
      area: venueArea(venue),
    },
    performers: metadata.performersByEvent.get(row.id) || [],
    genres: metadata.genresByEvent.get(row.id) || [],
    price: summarizeEntranceCosts(row.entrance_costs, fallbackCurrency),
    flyer_url: flyer,
    nlt_url: buildEventUrl(baseUrl, citySlug, row.id),
  };
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

export async function searchEvents(
  supabase: SupabaseClient,
  config: AppConfig,
  input: SearchEventsInput,
): Promise<SearchEventsOutput> {
  const citySlug = normalizeCity(input.city, config.defaultCity);
  const city = await getCityContext(
    supabase,
    citySlug,
    config.defaultCountryCode,
  );

  if (!city) {
    return {
      city: citySlug,
      date_filter: input.date || null,
      events: [],
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
    parsedDate = parseDateFilter(
      input.date,
      now,
      city.timezone,
      city.serviceDayCutoffTime,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid date filter.";
    throw new NightlifeError("INVALID_DATE_FILTER", message);
  }

  const genreEventIds = input.genre
    ? await resolveGenreEventIds(supabase, input.genre)
    : null;
  if (genreEventIds && genreEventIds.size === 0) {
    return {
      city: city.slug,
      date_filter: parsedDate?.label || null,
      events: [],
      unavailable_city: null,
    };
  }

  const queryText = input.query ? sanitizeIlike(input.query) : "";
  const limit = coerceLimit(input.limit);
  const offset = coerceOffset(input.offset);
  const needsClientFiltering =
    Boolean(input.area) ||
    Boolean(queryText) ||
    Boolean(genreEventIds && genreEventIds.size > 0);

  const baseRange = needsClientFiltering
    ? { from: 0, to: Math.min(199, offset + limit + 50) }
    : { from: offset, to: offset + limit - 1 };

  let occurrences: EventOccurrenceRow[];
  let clientPagingApplied = false;

  if (genreEventIds && genreEventIds.size > 0) {
    occurrences = await fetchOccurrencesByIds(
      supabase,
      city.id,
      Array.from(genreEventIds),
      parsedDate,
      city.timezone,
      city.serviceDayCutoffTime,
      queryText,
    );

    if (!input.area && !queryText) {
      occurrences = occurrences.slice(offset, offset + limit);
      clientPagingApplied = true;
    }
  } else {
    let query = supabase
      .from("event_occurrences")
      .select(OCCURRENCE_SELECT)
      .eq("published", true)
      .eq("city_id", city.id)
      .order("start_at", { ascending: true })
      .range(baseRange.from, baseRange.to);

    if (parsedDate) {
      const window = serviceDateWindowToUtc(
        parsedDate.startServiceDate,
        parsedDate.endServiceDateExclusive,
        city.timezone,
        city.serviceDayCutoffTime,
      );
      query = query.gte("start_at", window.startIso).lt("start_at", window.endIso);
    }

    if (queryText) {
      query = query.or(
        `name_en.ilike.%${queryText}%,description_en.ilike.%${queryText}%`,
      );
    }

    const { data: rows, error } = await query;
    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch events.", {
        cause: error.message,
      });
    }
    occurrences = (rows || []) as unknown as EventOccurrenceRow[];
  }

  const occurrenceIds = occurrences.map((row) => row.id);
  const metadata = await fetchOccurrenceMetadata(supabase, occurrenceIds);

  const fallbackCurrency = defaultCurrencyForCountry(city.countryCode);
  let summaries = occurrences.map((row) =>
    toEventSummary(
      row,
      city.slug,
      config.nightlifeBaseUrl,
      fallbackCurrency,
      metadata,
    ),
  );

  if (input.area) {
    summaries = summaries.filter((summary) =>
      matchArea(
        occurrences.find((row) => row.id === summary.event_id)!,
        input.area || "",
      ),
    );
  }

  if (queryText) {
    summaries = summaries.filter((summary) => {
      const row = occurrences.find((occurrence) => occurrence.id === summary.event_id);
      if (!row) {
        return false;
      }
      return matchQuery(row, queryText, summary.performers, summary.genres);
    });
  }

  if (needsClientFiltering && !clientPagingApplied) {
    summaries = summaries.slice(offset, offset + limit);
  }

  return {
    city: city.slug,
    date_filter: parsedDate?.label || null,
    events: summaries,
    unavailable_city: null,
  };
}

function tierText(tier: {
  tier_name: string;
  price: number | null;
  currency: string | null;
}, fallbackCurrency: string): string {
  if (tier.price === null) {
    return tier.tier_name;
  }
  const ccy = tier.currency || fallbackCurrency;
  return `${tier.tier_name}: ${ccy} ${Math.round(tier.price)}`;
}

export async function getEventDetails(
  supabase: SupabaseClient,
  config: AppConfig,
  eventId: string,
): Promise<EventDetail | null> {
  const cleanedId = eventId.trim();
  if (!cleanedId) {
    throw new NightlifeError("INVALID_EVENT_ID", "event_id cannot be blank.");
  }

  if (cleanedId.startsWith("virtual:")) {
    throw new NightlifeError(
      "UNSUPPORTED_EVENT_ID",
      "virtual:* IDs are reserved for future support. Use a concrete event occurrence ID.",
    );
  }
  if (!UUID_RE.test(cleanedId)) {
    throw new NightlifeError(
      "INVALID_EVENT_ID",
      "event_id must be a UUID in v1.",
    );
  }

  const { data: occurrence, error } = await supabase
    .from("event_occurrences")
    .select(
      "id,city_id,venue_id,name_en,name_i18n,description_en,description_i18n,start_at,end_at,published,featured,source,source_url,entrance_costs,venue:venues(id,name,name_en,name_ja,address,address_en,address_ja,city,city_en,city_ja,website),occurrence_days:event_occurrence_days(id,service_date,start_at,end_at,published,title_en_override,title_i18n_override)",
    )
    .eq("id", cleanedId)
    .eq("published", true)
    .maybeSingle<EventOccurrenceRow>();

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch event details.", {
      cause: error.message,
    });
  }
  if (!occurrence) {
    return null;
  }

  const cityQuery = occurrence.city_id
    ? await supabase
        .from("cities")
        .select("slug,timezone,service_day_cutoff_time,country_code")
        .eq("id", occurrence.city_id)
        .maybeSingle()
    : { data: null };

  const citySlug =
    (cityQuery.data?.slug as string | undefined)?.toLowerCase() ||
    config.defaultCity;
  const fallbackCurrency = defaultCurrencyForCountry(
    (cityQuery.data?.country_code as string | undefined) || config.defaultCountryCode,
  );
  const timezone = (cityQuery.data?.timezone as string | undefined) || "UTC";
  const cutoffTime =
    (cityQuery.data?.service_day_cutoff_time as string | undefined) || "06:00";

  const dayIds = (occurrence.occurrence_days || [])
    .map((day) => day.id)
    .filter(Boolean);

  const [metadata, ticketOccurrenceResult, ticketDayResult, guestSettingsResult] =
    await Promise.all([
      fetchOccurrenceMetadata(supabase, [occurrence.id]),
      supabase
        .from("event_ticket_tiers")
        .select("tier_name,price,currency,status,url,provider")
        .eq("occurrence_id", occurrence.id),
      dayIds.length > 0
        ? supabase
            .from("event_ticket_tiers")
            .select("tier_name,price,currency,status,url,provider,event_day_id")
            .in("event_day_id", dayIds)
        : Promise.resolve({ data: [], error: null }),
      dayIds.length > 0
        ? supabase
            .from("event_guest_list_settings")
            .select("event_day_id,enabled,capacity,cutoff_time")
            .in("event_day_id", dayIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (ticketOccurrenceResult.error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch ticket tiers.", {
      cause: ticketOccurrenceResult.error.message,
    });
  }
  if (ticketDayResult.error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch day ticket tiers.", {
      cause: ticketDayResult.error.message,
    });
  }
  if (guestSettingsResult.error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch guest list settings.", {
      cause: guestSettingsResult.error.message,
    });
  }

  const tiers = [
    ...(ticketOccurrenceResult.data || []),
    ...(ticketDayResult.data || []),
  ]
    .map((row) => ({
      tier_name: String(row.tier_name || "Unknown Tier"),
      price: typeof row.price === "number" ? row.price : null,
      currency: row.currency || null,
      status: row.status || "on_sale",
      url: row.url || null,
      provider: row.provider || null,
    }))
    .sort((a, b) => a.tier_name.localeCompare(b.tier_name));

  const lowerTier = (value: string) => value.toLowerCase();
  const doorTier = tiers.find((tier) => lowerTier(tier.tier_name).includes("door"));
  const advanceTier = tiers.find((tier) => {
    const value = lowerTier(tier.tier_name);
    return value.includes("advance") || value.includes("presale") || value.includes("early");
  });

  const day = primaryDay(occurrence.occurrence_days);
  const settings = (guestSettingsResult.data || []).find(
    (row) => row.event_day_id === day?.id,
  );

  let guestStatus: "available" | "full" | "closed" = "closed";
  if (settings?.enabled === true && day?.service_date) {
    const cutoffPassed = isCutoffPassedForServiceDate(
      new Date(),
      day.service_date,
      timezone,
      settings.cutoff_time || cutoffTime,
    );

    if (!cutoffPassed) {
      if (typeof settings.capacity === "number" && settings.capacity >= 0) {
        const countResult = await supabase
          .from("event_guest_list_entries")
          .select("id", { count: "exact", head: true })
          .eq("event_day_id", day.id);

        if (countResult.error) {
          throw new NightlifeError(
            "DB_QUERY_FAILED",
            "Failed to fetch guest list counts.",
            { cause: countResult.error.message },
          );
        }

        const currentCount = countResult.count || 0;
        guestStatus = currentCount >= settings.capacity ? "full" : "available";
      } else {
        guestStatus = "available";
      }
    }
  }

  const flyer = metadata.mediaByEvent.get(occurrence.id)?.[0]?.media_url || null;
  const lineup = metadata.lineupByEvent.get(occurrence.id) || [];
  const venue = firstRelation(occurrence.venue);
  const address = venue?.address_en || venue?.address || venue?.address_ja || null;

  return {
    event_id: occurrence.id,
    name: eventName(occurrence),
    date: day?.start_at || occurrence.start_at || "",
    start_time: day?.start_at || occurrence.start_at || null,
    end_time: day?.end_at || occurrence.end_at || null,
    service_date: day?.service_date || null,
    venue: {
      id: venue?.id || occurrence.venue_id || "",
      name: venueName(venue),
      area: venueArea(venue),
      address,
      map_link: buildMapLink(address),
      website: venue?.website || null,
    },
    lineup,
    genres: metadata.genresByEvent.get(occurrence.id) || [],
    price: {
      entrance_summary: summarizeEntranceCosts(occurrence.entrance_costs, fallbackCurrency),
      door: doorTier ? tierText(doorTier, fallbackCurrency) : null,
      advance: advanceTier ? tierText(advanceTier, fallbackCurrency) : null,
      tiers,
    },
    flyer_url: flyer,
    guest_list_status: guestStatus,
    nlt_url: buildEventUrl(config.nightlifeBaseUrl, citySlug, occurrence.id),
  };
}
