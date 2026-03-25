import type { SupabaseClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";
import type { AppConfig } from "../config.js";
import type {
  CityUnavailable,
  EventSummary,
  SearchVenuesOutput,
  VenueDetail,
  VenueSummary,
} from "../types.js";
import { NightlifeError } from "../errors.js";
import { getCityContext, listAvailableCities } from "./cities.js";
import {
  addDaysToIsoDate,
  getCurrentServiceDate,
  parseDateFilter,
  serviceDateWindowToUtc,
} from "../utils/time.js";
import { normalizeQuery } from "../utils/normalize.js";

type SearchVenuesInput = {
  city?: string;
  date?: string;
  area?: string;
  genre?: string;
  query?: string;
  vip_booking_supported_only?: boolean;
  limit?: number;
  offset?: number;
};

type VenueRow = {
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
  image_url: string | null;
  sns_instagram: string | null;
  sns_tiktok: string | null;
  sns_x: string | null;
  sns_youtube: string | null;
  guest_list_enabled: boolean | null;
  vip_booking_enabled: boolean | null;
  city_id: string | null;
  hours_timezone?: string | null;
  hours_weekly_json?: unknown;
};

type EventOccurrenceRow = {
  id: string;
  venue_id: string | null;
  city_id: string | null;
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
  venue: VenueRow | VenueRow[] | null;
};

type GenreRow = {
  event_id: string;
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

type MediaRow = {
  event_id: string;
  media_type: string;
  media_url: string;
  is_primary: boolean;
  display_order: number;
};

type StageRow = {
  event_id: string;
  event_timetables: Array<{
    performer:
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
  }> | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const VIP_HOURS_EVENT_PREFIX = "__vip_hours__:";
const VENUE_SELECT =
  "id,name,name_en,name_ja,address,address_en,address_ja,city,city_en,city_ja,website,image_url,sns_instagram,sns_tiktok,sns_x,sns_youtube,guest_list_enabled,vip_booking_enabled,city_id,hours_timezone,hours_weekly_json";

const OCCURRENCE_SELECT =
  `id,venue_id,city_id,name_en,name_i18n,description_en,description_i18n,entrance_costs,start_at,published,occurrence_days:event_occurrence_days(id,service_date,start_at,end_at,published,title_en_override,title_i18n_override),venue:venues(${VENUE_SELECT})`;

export type VenueHoursSlot = {
  open_day: number;
  close_day: number;
  open_time: string;
  close_time: string;
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

function normalizeTimeOfDay(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (HH_MM_RE.test(trimmed)) {
    return trimmed;
  }
  const withSeconds = /^([01]\d|2[0-3]):([0-5]\d):[0-5]\d$/.exec(trimmed);
  if (withSeconds) {
    return `${withSeconds[1]}:${withSeconds[2]}`;
  }
  return null;
}

function normalizeWeekday(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) {
    return null;
  }
  return parsed;
}

export function parseVenueHoursSlots(raw: unknown): VenueHoursSlot[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const slots: VenueHoursSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const openDay = normalizeWeekday(row.open_day);
    const closeDay = normalizeWeekday(row.close_day);
    const openTime = normalizeTimeOfDay(row.open_time);
    const closeTime = normalizeTimeOfDay(row.close_time);

    if (openDay === null || closeDay === null || !openTime || !closeTime) {
      continue;
    }

    slots.push({
      open_day: openDay,
      close_day: closeDay,
      open_time: openTime,
      close_time: closeTime,
    });
  }

  return slots.sort((a, b) => {
    if (a.open_day !== b.open_day) {
      return a.open_day - b.open_day;
    }
    if (a.open_time !== b.open_time) {
      return a.open_time.localeCompare(b.open_time);
    }
    if (a.close_day !== b.close_day) {
      return a.close_day - b.close_day;
    }
    return a.close_time.localeCompare(b.close_time);
  });
}

function normalizeHoursTimeZone(
  value: string | null | undefined,
  fallbackTimeZone: string,
): string {
  const candidates = [value, fallbackTimeZone, "UTC"]
    .map((candidate) => String(candidate || "").trim())
    .filter((candidate) => candidate.length > 0)
    .map((candidate) => {
      const offset = /^UTC([+-]\d{2}:\d{2})$/i.exec(candidate);
      return offset ? offset[1] : candidate;
    });

  for (const candidate of candidates) {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(
        new Date("2026-01-01T00:00:00Z"),
      );
      return candidate;
    } catch {
      continue;
    }
  }

  return "UTC";
}

export function serviceDateDayOfWeek(serviceDate: string): number {
  return new Date(`${serviceDate}T00:00:00Z`).getUTCDay();
}

function isVipHoursSyntheticId(eventId: string): boolean {
  return eventId.startsWith(VIP_HOURS_EVENT_PREFIX);
}

function buildVipHoursSyntheticOccurrences(
  venue: VenueRow,
  startServiceDate: string,
  endServiceDateExclusive: string,
  fallbackTimeZone: string,
): EventOccurrenceRow[] {
  if (venue.vip_booking_enabled !== true) {
    return [];
  }

  const slots = parseVenueHoursSlots(venue.hours_weekly_json);
  if (slots.length === 0) {
    return [];
  }

  const hoursTimeZone = normalizeHoursTimeZone(venue.hours_timezone, fallbackTimeZone);
  const rows: EventOccurrenceRow[] = [];
  const seen = new Set<string>();

  for (
    let serviceDate = startServiceDate;
    serviceDate < endServiceDateExclusive;
    serviceDate = addDaysToIsoDate(serviceDate, 1)
  ) {
    const dayOfWeek = serviceDateDayOfWeek(serviceDate);
    for (const slot of slots) {
      if (slot.open_day !== dayOfWeek) {
        continue;
      }

      const closeOffsetRaw = (slot.close_day - slot.open_day + 7) % 7;
      const closeOffsetDays =
        closeOffsetRaw === 0 && slot.close_time <= slot.open_time
          ? 1
          : closeOffsetRaw;
      const closeServiceDate = addDaysToIsoDate(serviceDate, closeOffsetDays);
      const dedupeKey = `${serviceDate}|${slot.open_time}|${closeServiceDate}|${slot.close_time}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      const startIso = fromZonedTime(
        `${serviceDate}T${slot.open_time}:00`,
        hoursTimeZone,
      ).toISOString();
      const endIso = fromZonedTime(
        `${closeServiceDate}T${slot.close_time}:00`,
        hoursTimeZone,
      ).toISOString();
      const eventId =
        `${VIP_HOURS_EVENT_PREFIX}${venue.id}:${serviceDate}:${slot.open_time.replace(
          ":",
          "",
        )}:${slot.close_day}:${slot.close_time.replace(":", "")}`;

      rows.push({
        id: eventId,
        venue_id: venue.id,
        city_id: venue.city_id,
        name_en: "VIP Booking Available",
        name_i18n: null,
        description_en: "Venue open with VIP booking availability.",
        description_i18n: null,
        entrance_costs: null,
        start_at: startIso,
        published: true,
        occurrence_days: [
          {
            id: `${eventId}:day`,
            service_date: serviceDate,
            start_at: startIso,
            end_at: endIso,
            published: true,
            title_en_override: "VIP Booking Available",
            title_i18n_override: null,
          },
        ],
        venue,
      });
    }
  }

  return rows.sort((a, b) => String(a.start_at || "").localeCompare(String(b.start_at || "")));
}

export async function fetchVipVenuesWithHours(
  supabase: SupabaseClient,
  cityId: string,
): Promise<VenueRow[]> {
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_SELECT)
    .eq("city_id", cityId)
    .eq("vip_booking_enabled", true)
    .not("hours_weekly_json", "is", null);

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch VIP venue hours.", {
      cause: error.message,
    });
  }

  return (data || []) as unknown as VenueRow[];
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

export function venueName(venue: VenueRow | null): string {
  if (!venue) {
    return "Unknown Venue";
  }
  return venue.name_en || venue.name || venue.name_ja || "Unknown Venue";
}

export function venueArea(venue: VenueRow | null): string | null {
  if (!venue) {
    return null;
  }
  return venue.city_en || venue.city || venue.city_ja || null;
}

function venueAddress(venue: VenueRow | null): string | null {
  if (!venue) {
    return null;
  }
  return venue.address_en || venue.address || venue.address_ja || null;
}

export function defaultCurrencyForCountry(countryCode?: string | null): string {
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

export function buildVenueUrl(baseUrl: string, citySlug: string, venueId: string): string {
  return `${baseUrl}/en/${citySlug}/venues/${venueId}`;
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

async function resolveGenreEventIds(
  supabase: SupabaseClient,
  genreInput: string,
): Promise<Set<string>> {
  const needle = sanitizeIlike(genreInput).toLowerCase();
  if (!needle) {
    return new Set();
  }

  const matches = new Set<string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("event_genres")
      .select("event_id,genre:genres(name,name_en,name_ja)")
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch genre mappings.", {
        cause: error.message,
      });
    }

    const rows = (data || []) as unknown as GenreRow[];
    for (const row of rows) {
      const genre = firstRelation(row.genre);
      if (!genre) {
        continue;
      }
      if (hasNeedle(needle, genre.name, genre.name_en, genre.name_ja)) {
        matches.add(row.event_id);
      }
    }

    if (rows.length < pageSize) {
      break;
    }
  }

  return matches;
}

async function fetchGenresByEvent(
  supabase: SupabaseClient,
  eventIds: string[],
): Promise<Map<string, string[]>> {
  const genresByEvent = new Map<string, string[]>();
  if (eventIds.length === 0) {
    return genresByEvent;
  }

  for (const idsChunk of chunkArray(eventIds, 100)) {
    const { data, error } = await supabase
      .from("event_genres")
      .select("event_id,genre:genres(name,name_en,name_ja)")
      .in("event_id", idsChunk);

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch event genres.", {
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
      const existing = genresByEvent.get(row.event_id) || [];
      if (!existing.includes(name)) {
        existing.push(name);
        genresByEvent.set(row.event_id, existing);
      }
    }
  }

  return genresByEvent;
}

async function fetchOccurrenceMetadata(
  supabase: SupabaseClient,
  occurrenceIds: string[],
): Promise<{
  genresByEvent: Map<string, string[]>;
  mediaByEvent: Map<string, MediaRow[]>;
  performersByEvent: Map<string, string[]>;
}> {
  const realEventIds = occurrenceIds.filter((id) => UUID_RE.test(id));
  const genresByEvent = await fetchGenresByEvent(supabase, realEventIds);
  const mediaByEvent = new Map<string, MediaRow[]>();
  const performersByEvent = new Map<string, string[]>();

  if (realEventIds.length === 0) {
    return { genresByEvent, mediaByEvent, performersByEvent };
  }

  for (const idsChunk of chunkArray(realEventIds, 100)) {
    const [{ data: mediaRows, error: mediaError }, { data: stageRows, error: stageError }] =
      await Promise.all([
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

    if (mediaError) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch event media.", {
        cause: mediaError.message,
      });
    }
    if (stageError) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch lineup metadata.", {
        cause: stageError.message,
      });
    }

    for (const row of (mediaRows || []) as unknown as MediaRow[]) {
      const list = mediaByEvent.get(row.event_id) || [];
      list.push(row);
      mediaByEvent.set(row.event_id, list);
    }

    for (const row of (stageRows || []) as unknown as StageRow[]) {
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

  for (const [eventId, list] of mediaByEvent.entries()) {
    list.sort((a, b) => {
      if (a.is_primary !== b.is_primary) {
        return Number(b.is_primary) - Number(a.is_primary);
      }
      return a.display_order - b.display_order;
    });
    mediaByEvent.set(eventId, list);
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
  const venue = firstRelation(row.venue);
  const flyer = metadata.mediaByEvent.get(row.id)?.[0]?.media_url || null;
  const venueId = venue?.id || row.venue_id || "";
  const syntheticVipHours = isVipHoursSyntheticId(row.id);

  return {
    event_id: row.id,
    name: eventName(row),
    date: day?.start_at || row.start_at || "",
    service_date: day?.service_date || null,
    venue: {
      id: venueId,
      name: venueName(venue),
      area: venueArea(venue),
    },
    performers: metadata.performersByEvent.get(row.id) || [],
    genres: metadata.genresByEvent.get(row.id) || [],
    price: summarizeEntranceCosts(row.entrance_costs, fallbackCurrency),
    flyer_url: flyer,
    nlt_url: syntheticVipHours
      ? buildVenueUrl(baseUrl, citySlug, venueId)
      : buildEventUrl(baseUrl, citySlug, row.id),
  };
}

function rankVenueSummaries(venues: VenueSummary[]): VenueSummary[] {
  return [...venues].sort((a, b) => {
    if (a.upcoming_event_count !== b.upcoming_event_count) {
      return b.upcoming_event_count - a.upcoming_event_count;
    }

    if (a.next_event_date && b.next_event_date) {
      if (a.next_event_date !== b.next_event_date) {
        return a.next_event_date.localeCompare(b.next_event_date);
      }
    } else if (a.next_event_date) {
      return -1;
    } else if (b.next_event_date) {
      return 1;
    }

    return a.name.localeCompare(b.name);
  });
}

async function fuzzyVenueIds(
  supabase: SupabaseClient,
  cityId: string,
  rawQuery: string,
): Promise<string[]> {
  const normalized = normalizeQuery(rawQuery);
  if (!normalized) return [];

  const { data, error } = await supabase.rpc("search_venues_fuzzy", {
    p_city_id: cityId,
    p_query: normalized,
    p_threshold: 0.15,
    p_limit: 20,
  });

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Fuzzy venue search failed.", {
      cause: error.message,
    });
  }

  return ((data || []) as Array<{ id: string }>).map((row) => row.id);
}

function shouldAttemptFuzzy(
  resultCount: number,
  queryNeedle: string,
  genreEventIds: Set<string> | null,
): boolean {
  return resultCount === 0 && queryNeedle.trim().length > 0 && genreEventIds === null;
}

export const __testOnly_rankVenueSummaries = rankVenueSummaries;
export const __testOnly_buildVipHoursSyntheticOccurrences = buildVipHoursSyntheticOccurrences;
export const __testOnly_shouldAttemptFuzzy = shouldAttemptFuzzy;

export async function searchVenues(
  supabase: SupabaseClient,
  config: AppConfig,
  input: SearchVenuesInput,
): Promise<SearchVenuesOutput> {
  const citySlug = normalizeCity(input.city, config.defaultCity);
  const city = await getCityContext(supabase, citySlug, config.defaultCountryCode);

  if (!city) {
    return {
      city: citySlug,
      date_filter: input.date || null,
      venues: [],
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

  const genreEventIds = input.genre
    ? await resolveGenreEventIds(supabase, input.genre)
    : null;

  if (genreEventIds && genreEventIds.size === 0) {
    return {
      city: city.slug,
      date_filter: parsedDate?.label || null,
      venues: [],
      unavailable_city: null,
    };
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

  const { data, error } = await supabase
    .from("event_occurrences")
    .select(OCCURRENCE_SELECT)
    .eq("published", true)
    .eq("city_id", city.id)
    .not("venue_id", "is", null)
    .gte("start_at", window.startIso)
    .lt("start_at", window.endIso)
    .order("start_at", { ascending: true })
    .range(0, 1999);

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch venue events.", {
      cause: error.message,
    });
  }

  const queryNeedle = input.query ? sanitizeIlike(input.query).toLowerCase() : "";
  const areaNeedle = input.area ? input.area.trim().toLowerCase() : "";
  const vipBookingSupportedOnly = input.vip_booking_supported_only === true;

  let occurrences = (data || []) as unknown as EventOccurrenceRow[];
  if (genreEventIds) {
    occurrences = occurrences.filter((row) => genreEventIds.has(row.id));
  }

  const vipHourOccurrences =
    genreEventIds === null
      ? (
          await fetchVipVenuesWithHours(supabase, city.id)
        ).flatMap((venue) =>
          buildVipHoursSyntheticOccurrences(
            venue,
            startServiceDate,
            endServiceDateExclusive,
            city.timezone,
          ),
        )
      : [];

  const effectiveOccurrences = [...occurrences, ...vipHourOccurrences];
  if (effectiveOccurrences.length === 0) {
    return {
      city: city.slug,
      date_filter: parsedDate?.label || null,
      venues: [],
      unavailable_city: null,
    };
  }

  const genresByEvent = await fetchGenresByEvent(
    supabase,
    occurrences.map((row) => row.id),
  );

  const aggregates = new Map<
    string,
    {
      venue: VenueRow;
      nextEventDate: string | null;
      eventCount: number;
      genreCounts: Map<string, number>;
      eventNames: string[];
    }
  >();

  for (const row of effectiveOccurrences) {
    const venue = firstRelation(row.venue);
    if (!venue) {
      continue;
    }

    const venueId = venue.id || row.venue_id;
    if (!venueId) {
      continue;
    }

    if (vipBookingSupportedOnly && venue.vip_booking_enabled !== true) {
      continue;
    }

    if (
      areaNeedle &&
      !hasNeedle(
        areaNeedle,
        venue.city,
        venue.city_en,
        venue.city_ja,
        venue.address,
        venue.address_en,
        venue.address_ja,
      )
    ) {
      continue;
    }

    const genreNames = genresByEvent.get(row.id) || [];
    if (
      queryNeedle &&
      !hasNeedle(
        queryNeedle,
        venue.name,
        venue.name_en,
        venue.name_ja,
        venue.city,
        venue.city_en,
        venue.city_ja,
        venue.address,
        venue.address_en,
        venue.address_ja,
        row.name_en,
        maybeJa(row.name_i18n),
        row.description_en,
        maybeJa(row.description_i18n),
      ) &&
      !genreNames.some((name) => name.toLowerCase().includes(queryNeedle))
    ) {
      continue;
    }

    const current =
      aggregates.get(venueId) ||
      {
        venue,
        nextEventDate: null,
        eventCount: 0,
        genreCounts: new Map<string, number>(),
        eventNames: [],
      };

    current.eventCount += 1;

    const eventDate = primaryDay(row.occurrence_days)?.start_at || row.start_at || null;
    if (eventDate && (!current.nextEventDate || eventDate < current.nextEventDate)) {
      current.nextEventDate = eventDate;
    }

    for (const genre of genreNames) {
      current.genreCounts.set(genre, (current.genreCounts.get(genre) || 0) + 1);
    }

    current.eventNames.push(eventName(row));
    aggregates.set(venueId, current);
  }

  const summaries: VenueSummary[] = Array.from(aggregates.entries()).map(([venueId, value]) => {
    const sortedGenres = Array.from(value.genreCounts.entries())
      .sort((a, b) => {
        if (a[1] !== b[1]) {
          return b[1] - a[1];
        }
        return a[0].localeCompare(b[0]);
      })
      .map(([genre]) => genre)
      .slice(0, 5);

    return {
      venue_id: venueId,
      name: venueName(value.venue),
      area: venueArea(value.venue),
      address: venueAddress(value.venue),
      website: value.venue.website || null,
      image_url: value.venue.image_url || null,
      vip_booking_supported: value.venue.vip_booking_enabled === true,
      upcoming_event_count: value.eventCount,
      next_event_date: value.nextEventDate,
      genres: sortedGenres,
      nlt_url: buildVenueUrl(config.nightlifeBaseUrl, city.slug, venueId),
    };
  });

  // Pass 2: Fuzzy RPC fallback when pass 1 found nothing and a text query was provided
  if (shouldAttemptFuzzy(summaries.length, queryNeedle, genreEventIds)) {
    const fuzzyIds = await fuzzyVenueIds(supabase, city.id, input.query || "");
    if (fuzzyIds.length > 0) {
      // Fetch event occurrences for fuzzy-matched venues within the same date window
      const { data: fuzzyData, error: fuzzyError } = await supabase
        .from("event_occurrences")
        .select(OCCURRENCE_SELECT)
        .eq("published", true)
        .eq("city_id", city.id)
        .in("venue_id", fuzzyIds)
        .gte("start_at", window.startIso)
        .lt("start_at", window.endIso)
        .order("start_at", { ascending: true })
        .range(0, 1999);

      if (fuzzyError) {
        throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch fuzzy venue events.", {
          cause: fuzzyError.message,
        });
      }

      // Merge VIP hours synthetic occurrences for fuzzy venues
      const fuzzyIdSet = new Set(fuzzyIds);
      const fuzzyVipHours = vipHourOccurrences.filter(
        (row) => row.venue_id && fuzzyIdSet.has(row.venue_id),
      );
      const fuzzyOccurrences = [
        ...((fuzzyData || []) as unknown as EventOccurrenceRow[]),
        ...fuzzyVipHours,
      ];

      if (fuzzyOccurrences.length > 0) {
        // Fetch genres for fuzzy occurrences (only real UUIDs, not synthetic VIP IDs)
        const fuzzyGenresByEvent = await fetchGenresByEvent(
          supabase,
          fuzzyOccurrences.filter((r) => UUID_RE.test(r.id)).map((r) => r.id),
        );

        // Aggregate fuzzy occurrences into VenueSummary objects.
        // Same aggregation loop as pass 1, but WITHOUT the queryNeedle filter
        // (we already know these venues match the query via the RPC).
        const fuzzyAggregates = new Map<
          string,
          {
            venue: VenueRow;
            nextEventDate: string | null;
            eventCount: number;
            genreCounts: Map<string, number>;
            eventNames: string[];
          }
        >();

        for (const row of fuzzyOccurrences) {
          const venue = firstRelation(row.venue);
          if (!venue) continue;
          const venueId = venue.id || row.venue_id;
          if (!venueId) continue;
          if (vipBookingSupportedOnly && venue.vip_booking_enabled !== true) continue;
          if (
            areaNeedle &&
            !hasNeedle(
              areaNeedle,
              venue.city,
              venue.city_en,
              venue.city_ja,
              venue.address,
              venue.address_en,
              venue.address_ja,
            )
          )
            continue;

          const genreNames = fuzzyGenresByEvent.get(row.id) || [];
          const current = fuzzyAggregates.get(venueId) || {
            venue,
            nextEventDate: null,
            eventCount: 0,
            genreCounts: new Map<string, number>(),
            eventNames: [],
          };
          current.eventCount += 1;
          const eventDate = primaryDay(row.occurrence_days)?.start_at || row.start_at || null;
          if (eventDate && (!current.nextEventDate || eventDate < current.nextEventDate)) {
            current.nextEventDate = eventDate;
          }
          for (const genre of genreNames) {
            current.genreCounts.set(genre, (current.genreCounts.get(genre) || 0) + 1);
          }
          current.eventNames.push(eventName(row));
          fuzzyAggregates.set(venueId, current);
        }

        // Build fuzzy summaries preserving RPC word_similarity order (VEN-03).
        // fuzzyIds is ordered by word_similarity DESC from the RPC.
        // The aggregation Map may have different insertion order (occurrence-based),
        // so we explicitly sort by the fuzzyIds position to preserve similarity ranking.
        const fuzzyIdOrder = new Map(fuzzyIds.map((id, idx) => [id, idx]));
        const fuzzySummaries: VenueSummary[] = Array.from(fuzzyAggregates.entries())
          .sort(([idA], [idB]) => {
            const orderA = fuzzyIdOrder.get(idA) ?? Number.MAX_SAFE_INTEGER;
            const orderB = fuzzyIdOrder.get(idB) ?? Number.MAX_SAFE_INTEGER;
            return orderA - orderB;
          })
          .map(([venueId, value]) => {
            const sortedGenres = Array.from(value.genreCounts.entries())
              .sort((a, b) => {
                if (a[1] !== b[1]) return b[1] - a[1];
                return a[0].localeCompare(b[0]);
              })
              .map(([genre]) => genre)
              .slice(0, 5);

            return {
              venue_id: venueId,
              name: venueName(value.venue),
              area: venueArea(value.venue),
              address: venueAddress(value.venue),
              website: value.venue.website || null,
              image_url: value.venue.image_url || null,
              vip_booking_supported: value.venue.vip_booking_enabled === true,
              upcoming_event_count: value.eventCount,
              next_event_date: value.nextEventDate,
              genres: sortedGenres,
              nlt_url: buildVenueUrl(config.nightlifeBaseUrl, city.slug, venueId),
            };
          });

        // IMPORTANT: Return fuzzy results directly, bypassing rankVenueSummaries().
        // rankVenueSummaries() re-ranks by event activity which would destroy the RPC's
        // word_similarity ordering. For fuzzy results, similarity-based ranking is correct:
        // a hotel concierge asking "find me celavi" should see the best fuzzy match first.
        const offset = coerceOffset(input.offset);
        const limit = coerceLimit(input.limit);
        const paged = fuzzySummaries.slice(offset, offset + limit);

        return {
          city: city.slug,
          date_filter: parsedDate?.label || null,
          venues: paged,
          unavailable_city: null,
        };
      }
    }
  }

  const offset = coerceOffset(input.offset);
  const limit = coerceLimit(input.limit);
  const paged = rankVenueSummaries(summaries).slice(offset, offset + limit);

  return {
    city: city.slug,
    date_filter: parsedDate?.label || null,
    venues: paged,
    unavailable_city: null,
  };
}

export async function getVenueInfo(
  supabase: SupabaseClient,
  config: AppConfig,
  venueId: string,
): Promise<VenueDetail | null> {
  const cleanedId = venueId.trim();
  if (!cleanedId) {
    throw new NightlifeError("INVALID_VENUE_ID", "venue_id cannot be blank.");
  }
  if (!UUID_RE.test(cleanedId)) {
    throw new NightlifeError("INVALID_VENUE_ID", "venue_id must be a UUID.");
  }

  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .select(VENUE_SELECT)
    .eq("id", cleanedId)
    .maybeSingle<VenueRow>();

  if (venueError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch venue details.", {
      cause: venueError.message,
    });
  }
  if (!venue) {
    return null;
  }

  const fallbackCity = await getCityContext(
    supabase,
    config.defaultCity,
    config.defaultCountryCode,
  );

  const cityContext = venue.city_id
    ? await supabase
        .from("cities")
        .select("id,slug,timezone,service_day_cutoff_time,country_code")
        .eq("id", venue.city_id)
        .maybeSingle<{
          id: string;
          slug: string;
          timezone: string;
          service_day_cutoff_time: string;
          country_code: string;
        }>()
    : { data: null, error: null };

  if (cityContext.error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to resolve venue city context.", {
      cause: cityContext.error.message,
    });
  }

  const citySlug =
    cityContext.data?.slug?.toLowerCase() || fallbackCity?.slug || config.defaultCity;
  const timezone = cityContext.data?.timezone || fallbackCity?.timezone || "UTC";
  const cutoffTime =
    cityContext.data?.service_day_cutoff_time ||
    fallbackCity?.serviceDayCutoffTime ||
    "06:00";
  const fallbackCurrency = defaultCurrencyForCountry(
    cityContext.data?.country_code || fallbackCity?.countryCode || config.defaultCountryCode,
  );

  const now = new Date();
  const currentServiceDate = getCurrentServiceDate(now, timezone, cutoffTime);
  const window = serviceDateWindowToUtc(
    currentServiceDate,
    addDaysToIsoDate(currentServiceDate, 31),
    timezone,
    cutoffTime,
  );

  const { data: occurrenceRows, error: occurrenceError } = await supabase
    .from("event_occurrences")
    .select(OCCURRENCE_SELECT)
    .eq("published", true)
    .eq("venue_id", venue.id)
    .gte("start_at", window.startIso)
    .lt("start_at", window.endIso)
    .order("start_at", { ascending: true })
    .range(0, 49);

  if (occurrenceError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch venue events.", {
      cause: occurrenceError.message,
    });
  }

  const occurrences = (occurrenceRows || []) as unknown as EventOccurrenceRow[];
  const vipHourOccurrences = buildVipHoursSyntheticOccurrences(
    venue,
    currentServiceDate,
    addDaysToIsoDate(currentServiceDate, 31),
    timezone,
  );
  const effectiveOccurrences = [...occurrences, ...vipHourOccurrences].sort((a, b) =>
    String(a.start_at || "").localeCompare(String(b.start_at || "")),
  );
  const metadata = await fetchOccurrenceMetadata(
    supabase,
    occurrences.map((row) => row.id),
  );

  const upcomingEvents = effectiveOccurrences
    .map((row) =>
      toEventSummary(row, citySlug, config.nightlifeBaseUrl, fallbackCurrency, metadata),
    )
    .slice(0, 5);

  return {
    venue_id: venue.id,
    name: venueName(venue),
    area: venueArea(venue),
    address: venueAddress(venue),
    website: venue.website || null,
    image_url: venue.image_url || null,
    vip_booking_supported: venue.vip_booking_enabled === true,
    sns_instagram: venue.sns_instagram || null,
    sns_tiktok: venue.sns_tiktok || null,
    sns_x: venue.sns_x || null,
    sns_youtube: venue.sns_youtube || null,
    guest_list_enabled: venue.guest_list_enabled,
    upcoming_event_count: effectiveOccurrences.length,
    upcoming_events: upcomingEvents,
    nlt_url: buildVenueUrl(config.nightlifeBaseUrl, citySlug, venue.id),
  };
}
