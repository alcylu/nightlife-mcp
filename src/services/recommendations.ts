import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import type {
  CityUnavailable,
  EventSummary,
  ModalTimeBucket,
  Recommendation,
  RecommendationsOutput,
} from "../types.js";
import { MODAL_ANCHORS, type ModalAnchor } from "../constants/modals.js";
import { NightlifeError } from "../errors.js";
import { logEvent } from "../observability/metrics.js";
import { getCityContext, listAvailableCities } from "./cities.js";
import {
  isCutoffPassedForServiceDate,
  parseDateFilter,
  serviceDateWindowToUtc,
} from "../utils/time.js";
import {
  deriveBudgetScore,
  deriveDiscoveryScore,
  deriveEnergyScore,
  deriveQualityScore,
  deriveSocialScore,
  diversityScore,
  modalDistance,
  modalFit,
  preferenceBoost,
  toTimeBucket,
  type DiversitySnapshot,
  type RecommendationVector,
} from "../utils/recommendationFeatures.js";

type RecommendationInput = {
  city?: string;
  date?: string;
  area?: string;
  genre?: string;
  query?: string;
  limit?: number;
};

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

type TicketOccurrenceRow = {
  occurrence_id: string;
};

type TicketDayRow = {
  event_day_id: string;
};

type GuestSettingRow = {
  event_day_id: string;
  enabled: boolean | null;
  capacity: number | null;
  cutoff_time: string | null;
};

type Candidate = {
  event: EventSummary;
  vector: RecommendationVector;
  qualityScore: number;
  preferenceScore: number;
  primaryGenre: string | null;
  area: string | null;
};

type SelectedCandidate = {
  modal: ModalAnchor;
  candidate: Candidate;
  hop: number | null;
  backfill: boolean;
};

export type RecommendationCandidate = Candidate;
export type SelectedRecommendationCandidate = SelectedCandidate;

const OCCURRENCE_SELECT =
  "id,city_id,venue_id,name_en,name_i18n,description_en,description_i18n,start_at,end_at,published,featured,entrance_costs,venue:venues(id,name,name_en,name_ja,address,address_en,address_ja,city,city_en,city_ja),occurrence_days:event_occurrence_days(id,service_date,start_at,end_at,published,title_en_override,title_i18n_override)";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }
  return Array.isArray(value) ? value[0] || null : value;
}

function maybeJa(i18n: unknown): string | null {
  if (!i18n || typeof i18n !== "object") {
    return null;
  }
  const value = (i18n as { ja?: unknown }).ja;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  const occJa = maybeJa(row.name_i18n);
  return (
    day?.title_en_override ||
    row.name_en ||
    dayJa ||
    occJa ||
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
    const label = [
      obj.label,
      obj.name,
      obj.tier_name,
      obj.type,
    ].find((value): value is string => typeof value === "string" && value.trim().length > 0);

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

function normalizeCity(value: string | undefined, fallback: string): string {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized || fallback;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 10;
  }
  return Math.min(10, Math.max(1, Math.floor(value || 10)));
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

function buildWhyThisFits(modal: ModalAnchor, candidate: Candidate): string[] {
  const reasons: string[] = [];
  const genre = candidate.primaryGenre;
  const area = candidate.area;

  if (genre) {
    reasons.push(`Strong ${genre} fit for the ${modal.name.toLowerCase()} vibe.`);
  } else {
    reasons.push(`Good overall fit for the ${modal.name.toLowerCase()} profile.`);
  }

  if (candidate.qualityScore >= 0.75) {
    reasons.push("High quality signal from lineup, availability, and event freshness.");
  } else if (area) {
    reasons.push(`Useful location fit in ${area} with a compatible time slot.`);
  } else {
    reasons.push("Balanced pick based on timing, energy, and diversity.");
  }

  return reasons.slice(0, 2);
}

function toEventSummary(
  row: EventOccurrenceRow,
  citySlug: string,
  baseUrl: string,
  fallbackCurrency: string,
  metadata: {
    genresByEvent: Map<string, string[]>;
    performersByEvent: Map<string, string[]>;
    flyerByEvent: Map<string, string | null>;
  },
): EventSummary {
  const day = primaryDay(row.occurrence_days);
  const venue = firstRelation(row.venue);
  const eventId = row.id;

  return {
    event_id: eventId,
    name: eventName(row),
    date: day?.start_at || row.start_at || "",
    service_date: day?.service_date || null,
    venue: {
      id: venue?.id || row.venue_id || "",
      name: venueName(venue),
      area: venueArea(venue),
    },
    performers: metadata.performersByEvent.get(eventId) || [],
    genres: metadata.genresByEvent.get(eventId) || [],
    price: summarizeEntranceCosts(row.entrance_costs, fallbackCurrency),
    flyer_url: metadata.flyerByEvent.get(eventId) || null,
    nlt_url: buildEventUrl(baseUrl, citySlug, eventId),
  };
}

async function fetchCandidates(
  supabase: SupabaseClient,
  cityId: string,
  parsedDate: ReturnType<typeof parseDateFilter>,
  timezone: string,
  cutoffTime: string,
): Promise<EventOccurrenceRow[]> {
  let query = supabase
    .from("event_occurrences")
    .select(OCCURRENCE_SELECT)
    .eq("published", true)
    .eq("city_id", cityId)
    .order("start_at", { ascending: true })
    .range(0, 399);

  if (parsedDate) {
    const window = serviceDateWindowToUtc(
      parsedDate.startServiceDate,
      parsedDate.endServiceDateExclusive,
      timezone,
      cutoffTime,
    );
    query = query.gte("start_at", window.startIso).lt("start_at", window.endIso);
  }

  const { data, error } = await query;
  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch recommendation candidates.", {
      cause: error.message,
    });
  }

  return (data || []) as unknown as EventOccurrenceRow[];
}

async function fetchMetadata(
  supabase: SupabaseClient,
  cityTimezone: string,
  cityCutoffTime: string,
  rows: EventOccurrenceRow[],
): Promise<{
  genresByEvent: Map<string, string[]>;
  performersByEvent: Map<string, string[]>;
  flyerByEvent: Map<string, string | null>;
  ticketCountByEvent: Map<string, number>;
  guestStatusByEvent: Map<string, "available" | "full" | "closed">;
}> {
  const eventIds = rows.map((row) => row.id).filter((id) => id.length > 0);
  if (eventIds.length === 0) {
    return {
      genresByEvent: new Map(),
      performersByEvent: new Map(),
      flyerByEvent: new Map(),
      ticketCountByEvent: new Map(),
      guestStatusByEvent: new Map(),
    };
  }

  const genreRows: GenreRow[] = [];
  const mediaRows: MediaRow[] = [];
  const stageRows: StageRow[] = [];
  const ticketOccurrenceRows: TicketOccurrenceRow[] = [];

  for (const chunk of chunkArray(eventIds, 100)) {
    const [genresRes, mediaRes, stagesRes, ticketsRes] = await Promise.all([
      supabase
        .from("event_genres")
        .select("event_id,genre:genres(name,name_en,name_ja)")
        .in("event_id", chunk),
      supabase
        .from("event_media")
        .select("event_id,media_url,is_primary,display_order")
        .eq("media_type", "image")
        .in("event_id", chunk),
      supabase
        .from("event_stages")
        .select("event_id,event_timetables(performer:performers(name,name_en,name_ja))")
        .in("event_id", chunk),
      supabase
        .from("event_ticket_tiers")
        .select("occurrence_id")
        .in("occurrence_id", chunk),
    ]);

    if (genresRes.error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch recommendation genres.", {
        cause: genresRes.error.message,
      });
    }
    if (mediaRes.error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch recommendation media.", {
        cause: mediaRes.error.message,
      });
    }
    if (stagesRes.error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch recommendation lineups.", {
        cause: stagesRes.error.message,
      });
    }
    if (ticketsRes.error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch recommendation ticket tiers.", {
        cause: ticketsRes.error.message,
      });
    }

    genreRows.push(...((genresRes.data || []) as unknown as GenreRow[]));
    mediaRows.push(...((mediaRes.data || []) as MediaRow[]));
    stageRows.push(...((stagesRes.data || []) as unknown as StageRow[]));
    ticketOccurrenceRows.push(...((ticketsRes.data || []) as TicketOccurrenceRow[]));
  }

  const dayToEvent = new Map<string, string>();
  const dayServiceDate = new Map<string, string>();
  for (const row of rows) {
    for (const day of row.occurrence_days || []) {
      if (!day.id) {
        continue;
      }
      dayToEvent.set(day.id, row.id);
      dayServiceDate.set(day.id, day.service_date);
    }
  }

  const dayIds = Array.from(dayToEvent.keys());
  const ticketDayRows: TicketDayRow[] = [];
  const guestSettingRows: GuestSettingRow[] = [];
  if (dayIds.length > 0) {
    for (const chunk of chunkArray(dayIds, 200)) {
      const [dayTicketRes, guestRes] = await Promise.all([
        supabase
          .from("event_ticket_tiers")
          .select("event_day_id")
          .in("event_day_id", chunk),
        supabase
          .from("event_guest_list_settings")
          .select("event_day_id,enabled,capacity,cutoff_time")
          .in("event_day_id", chunk),
      ]);

      if (dayTicketRes.error) {
        throw new NightlifeError(
          "DB_QUERY_FAILED",
          "Failed to fetch recommendation day ticket tiers.",
          { cause: dayTicketRes.error.message },
        );
      }
      if (guestRes.error) {
        throw new NightlifeError(
          "DB_QUERY_FAILED",
          "Failed to fetch recommendation guest list settings.",
          { cause: guestRes.error.message },
        );
      }

      ticketDayRows.push(...((dayTicketRes.data || []) as TicketDayRow[]));
      guestSettingRows.push(...((guestRes.data || []) as GuestSettingRow[]));
    }
  }

  const genresByEvent = new Map<string, string[]>();
  for (const row of genreRows) {
    if (!row.event_id) {
      continue;
    }
    const genre = firstRelation(row.genre);
    const name = genre?.name_en || genre?.name || genre?.name_ja || null;
    if (!name) {
      continue;
    }
    const existing = genresByEvent.get(row.event_id) || [];
    if (!existing.includes(name)) {
      existing.push(name);
      genresByEvent.set(row.event_id, existing);
    }
  }

  const performersByEvent = new Map<string, string[]>();
  for (const row of stageRows) {
    if (!row.event_id) {
      continue;
    }
    const existing = new Set(performersByEvent.get(row.event_id) || []);
    for (const slot of row.event_timetables || []) {
      const performer = firstRelation(slot.performer);
      const name = performer?.name_en || performer?.name || performer?.name_ja || null;
      if (name) {
        existing.add(name);
      }
    }
    performersByEvent.set(row.event_id, Array.from(existing));
  }

  const flyerByEvent = new Map<string, string | null>();
  const groupedMedia = new Map<string, MediaRow[]>();
  for (const row of mediaRows) {
    if (!row.event_id) {
      continue;
    }
    const existing = groupedMedia.get(row.event_id) || [];
    existing.push(row);
    groupedMedia.set(row.event_id, existing);
  }
  for (const [eventId, list] of groupedMedia.entries()) {
    list.sort((a, b) => {
      if (a.is_primary !== b.is_primary) {
        return a.is_primary ? -1 : 1;
      }
      return a.display_order - b.display_order;
    });
    flyerByEvent.set(eventId, list[0]?.media_url || null);
  }

  const ticketCountByEvent = new Map<string, number>();
  for (const row of ticketOccurrenceRows) {
    if (!row.occurrence_id) {
      continue;
    }
    ticketCountByEvent.set(
      row.occurrence_id,
      (ticketCountByEvent.get(row.occurrence_id) || 0) + 1,
    );
  }
  for (const row of ticketDayRows) {
    if (!row.event_day_id) {
      continue;
    }
    const eventId = dayToEvent.get(row.event_day_id);
    if (!eventId) {
      continue;
    }
    ticketCountByEvent.set(eventId, (ticketCountByEvent.get(eventId) || 0) + 1);
  }

  const guestStatusByEvent = new Map<string, "available" | "full" | "closed">();
  for (const row of guestSettingRows) {
    if (!row.event_day_id) {
      continue;
    }
    const eventId = dayToEvent.get(row.event_day_id);
    const serviceDate = dayServiceDate.get(row.event_day_id);
    if (!eventId || !serviceDate) {
      continue;
    }

    const current = guestStatusByEvent.get(eventId) || "closed";
    if (current === "available") {
      continue;
    }

    if (!row.enabled) {
      guestStatusByEvent.set(eventId, current);
      continue;
    }

    const cutoffPassed = isCutoffPassedForServiceDate(
      new Date(),
      serviceDate,
      cityTimezone,
      row.cutoff_time || cityCutoffTime,
    );

    if (cutoffPassed) {
      guestStatusByEvent.set(eventId, current);
      continue;
    }

    if (typeof row.capacity === "number" && row.capacity <= 0) {
      guestStatusByEvent.set(eventId, "full");
      continue;
    }

    guestStatusByEvent.set(eventId, "available");
  }

  return {
    genresByEvent,
    performersByEvent,
    flyerByEvent,
    ticketCountByEvent,
    guestStatusByEvent,
  };
}

function toCandidate(
  occurrence: EventOccurrenceRow,
  event: EventSummary,
  cityTimezone: string,
  metadata: {
    ticketCountByEvent: Map<string, number>;
    guestStatusByEvent: Map<string, "available" | "full" | "closed">;
  },
  preferences: { area?: string; genre?: string; query?: string },
): Candidate {
  const performers = event.performers;
  const genres = event.genres;
  const ticketTierCount = metadata.ticketCountByEvent.get(event.event_id) || 0;
  const guestListStatus = metadata.guestStatusByEvent.get(event.event_id) || null;
  const timeBucket = toTimeBucket(event.date, cityTimezone);

  const vector: RecommendationVector = {
    energy: deriveEnergyScore(genres, event.name, performers.length),
    social: deriveSocialScore(genres, event.name, performers.length),
    discovery: deriveDiscoveryScore(genres, event.name, occurrence.featured === true),
    budget: deriveBudgetScore(event.price),
    timeBucket,
  };

  const qualityScore = deriveQualityScore({
    featured: occurrence.featured === true,
    performerCount: performers.length,
    ticketTierCount,
    guestListStatus,
    hasFlyer: Boolean(event.flyer_url),
    eventDate: event.date,
  });

  const preferenceScore = preferenceBoost({
    preferredArea: preferences.area,
    preferredGenre: preferences.genre,
    query: preferences.query,
    area: event.venue.area,
    genres,
    name: event.name,
    performers,
  });

  return {
    event,
    vector,
    qualityScore,
    preferenceScore,
    primaryGenre: genres[0] || null,
    area: event.venue.area,
  };
}

function candidateSnapshot(candidate: Candidate): DiversitySnapshot {
  return {
    area: candidate.area,
    primaryGenre: candidate.primaryGenre,
    timeBucket: candidate.vector.timeBucket,
  };
}

function selectRecommendationCandidates(
  allCandidates: Candidate[],
  slotCount: number,
): SelectedCandidate[] {
  const selected: SelectedCandidate[] = [];
  const selectedIds = new Set<string>();

  for (const modal of MODAL_ANCHORS.slice(0, slotCount)) {
    const remaining = allCandidates.filter((candidate) => !selectedIds.has(candidate.event.event_id));
    if (remaining.length === 0) {
      break;
    }

    const selectedSnapshots = selected.map((item) => candidateSnapshot(item.candidate));
    let picked: SelectedCandidate | null = null;

    for (const hop of [0, 1, 2, 3]) {
      const scored = remaining
        .map((candidate) => {
          const distance = modalDistance(candidate.vector, modal.target);
          const diversity = diversityScore(candidateSnapshot(candidate), selectedSnapshots);
          const fit = modalFit(distance);
          const finalScore =
            (0.65 * fit) +
            (0.25 * candidate.qualityScore) +
            (0.1 * diversity) +
            (0.08 * candidate.preferenceScore);

          return { candidate, distance, finalScore };
        })
        .filter((item) => item.distance <= hop)
        .sort((a, b) => b.finalScore - a.finalScore);

      if (scored.length > 0) {
        picked = {
          modal,
          candidate: scored[0].candidate,
          hop,
          backfill: false,
        };
        break;
      }
    }

    if (!picked) {
      const scored = remaining
        .map((candidate) => {
          const diversity = diversityScore(candidateSnapshot(candidate), selectedSnapshots);
          const score =
            (0.55 * candidate.qualityScore) +
            (0.45 * diversity) +
            (0.08 * candidate.preferenceScore);
          return { candidate, score };
        })
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        break;
      }

      picked = {
        modal,
        candidate: scored[0].candidate,
        hop: null,
        backfill: true,
      };
    }

    selectedIds.add(picked.candidate.event.event_id);
    selected.push(picked);
  }

  return selected;
}

function toRecommendations(selected: SelectedCandidate[]): Recommendation[] {
  return selected.map((item, index) => ({
    rank: index + 1,
    modal_id: item.modal.id,
    modal_name: item.modal.name,
    modal_description: item.modal.description,
    event: item.candidate.event,
    why_this_fits: buildWhyThisFits(item.modal, item.candidate),
  }));
}

export function __testOnly_selectRecommendationCandidates(
  allCandidates: Candidate[],
  slotCount: number,
): SelectedCandidate[] {
  return selectRecommendationCandidates(allCandidates, slotCount);
}

export async function getRecommendations(
  supabase: SupabaseClient,
  config: AppConfig,
  input: RecommendationInput,
): Promise<RecommendationsOutput> {
  const citySlug = normalizeCity(input.city, config.defaultCity);
  const city = await getCityContext(
    supabase,
    citySlug,
    config.defaultCountryCode,
  );

  const requestedDate = input.date?.trim() || "tonight";

  if (!city) {
    return {
      city: citySlug,
      date_filter: requestedDate,
      result_count: 0,
      recommendations: [],
      unavailable_city: await unavailableCityPayload(
        supabase,
        citySlug,
        config.nightlifeBaseUrl,
        config.topLevelCities,
      ),
    };
  }

  let parsedDate: ReturnType<typeof parseDateFilter>;
  try {
    parsedDate = parseDateFilter(
      requestedDate,
      new Date(),
      city.timezone,
      city.serviceDayCutoffTime,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid date filter.";
    throw new NightlifeError("INVALID_DATE_FILTER", message);
  }

  const rows = await fetchCandidates(
    supabase,
    city.id,
    parsedDate,
    city.timezone,
    city.serviceDayCutoffTime,
  );

  if (rows.length === 0) {
    return {
      city: city.slug,
      date_filter: parsedDate?.label || null,
      result_count: 0,
      recommendations: [],
      unavailable_city: null,
    };
  }

  const metadata = await fetchMetadata(
    supabase,
    city.timezone,
    city.serviceDayCutoffTime,
    rows,
  );
  const fallbackCurrency = defaultCurrencyForCountry(city.countryCode);

  const candidates = rows.map((row) => {
    const summary = toEventSummary(
      row,
      city.slug,
      config.nightlifeBaseUrl,
      fallbackCurrency,
      {
        genresByEvent: metadata.genresByEvent,
        performersByEvent: metadata.performersByEvent,
        flyerByEvent: metadata.flyerByEvent,
      },
    );

    return toCandidate(
      row,
      summary,
      city.timezone,
      {
        ticketCountByEvent: metadata.ticketCountByEvent,
        guestStatusByEvent: metadata.guestStatusByEvent,
      },
      {
        area: input.area,
        genre: input.genre,
        query: input.query,
      },
    );
  });

  const limit = normalizeLimit(input.limit);
  const selected = selectRecommendationCandidates(candidates, limit);
  const recommendations = toRecommendations(selected);

  const uniqueAreas = new Set(
    recommendations
      .map((item) => item.event.venue.area?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  const uniqueGenres = new Set(
    recommendations
      .flatMap((item) => item.event.genres.map((genre) => genre.trim().toLowerCase()))
      .filter((value) => value.length > 0),
  );

  logEvent("recommendations.generated", {
    city: city.slug,
    date_filter: parsedDate?.label || null,
    candidate_count: candidates.length,
    slot_hops: selected.map((item) => (item.hop === null ? "backfill" : String(item.hop))),
    backfill_count: selected.filter((item) => item.backfill).length,
    unique_area_count: uniqueAreas.size,
    unique_genre_count: uniqueGenres.size,
  });

  return {
    city: city.slug,
    date_filter: parsedDate?.label || null,
    result_count: recommendations.length,
    recommendations,
    unavailable_city: null,
  };
}
