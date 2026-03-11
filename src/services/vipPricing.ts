import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentServiceDate, serviceDateWindowToUtc, addDaysToIsoDate } from "../utils/time.js";
import { type VipPricingResult, type VipZonePricingSummary } from "../types.js";
import { NightlifeError } from "../errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const HTTP_URL_RE = /^https?:\/\/\S+$/i;

const DEFAULT_TIMEZONE = "Asia/Tokyo";
const DEFAULT_CUTOFF = "06:00";

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export type GetVipPricingInput = {
  venue_id: string;
  date?: string; // "tonight" | YYYY-MM-DD | undefined
};

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

type VipVenueRow = {
  id: string;
  name: string | null;
  city_id: string | null;
  vip_booking_enabled: boolean | null;
  vip_default_min_spend: number | string | null;
  vip_default_currency: string | null;
};

type VipVenueTableRow = {
  id: string;
  table_code: string;
  table_name: string;
  metadata: unknown;
  zone: string | null;
  capacity_min: number | null;
  capacity_max: number | null;
};

type VipTableDayDefaultRow = {
  vip_venue_table_id: string;
  day_of_week: number;
  min_spend: number | string | null;
  currency: string | null;
  note: string | null;
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type PricingDateContext = {
  closedDates: Set<string>;
  eventByDate: Map<string, string>;
};

// ---------------------------------------------------------------------------
// Helpers (self-contained — copied patterns from services/vipTables.ts)
// ---------------------------------------------------------------------------

function extractEventName(row: { name_en: string | null; name_i18n: unknown }): string {
  if (row.name_en) return row.name_en;
  if (row.name_i18n && typeof row.name_i18n === "object" && !Array.isArray(row.name_i18n)) {
    const i18n = row.name_i18n as Record<string, unknown>;
    if (typeof i18n.en === "string" && i18n.en) return i18n.en;
  }
  return "Event";
}

function ensureUuid(input: string, field: string): string {
  const normalized = String(input || "").trim();
  if (!UUID_RE.test(normalized)) {
    throw new NightlifeError("INVALID_REQUEST", `${field} must be a valid UUID.`);
  }
  return normalized;
}

function objectOrEmpty(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return { ...(input as Record<string, unknown>) };
}

function extractLayoutImageUrl(metadata: unknown): string | null {
  const obj = objectOrEmpty(metadata);
  const value = obj.layout_image_url;
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized || !HTTP_URL_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

function coerceMinSpend(raw: number | string | null): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(n) ? n : null;
}

function isWeekend(dayOfWeek: number): boolean {
  // 5=Fri, 6=Sat → weekend; 0=Sun, 1-4=Mon-Thu → weekday
  return dayOfWeek === 5 || dayOfWeek === 6;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function resolveVenueForPricing(
  supabase: SupabaseClient,
  venueId: string,
): Promise<VipVenueRow> {
  const { data, error } = await supabase
    .from("venues")
    .select("id,name,city_id,vip_booking_enabled,vip_default_min_spend,vip_default_currency")
    .eq("id", venueId)
    .maybeSingle<VipVenueRow>();

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load venue details.", {
      cause: error.message,
    });
  }
  if (!data) {
    throw new NightlifeError("VENUE_NOT_FOUND", "Venue not found.");
  }
  return data;
}

async function fetchPricingCityContext(
  supabase: SupabaseClient,
  cityId: string | null,
): Promise<{ timezone: string; cutoff: string }> {
  if (!cityId) {
    return { timezone: DEFAULT_TIMEZONE, cutoff: DEFAULT_CUTOFF };
  }

  const { data, error } = await supabase
    .from("cities")
    .select("timezone,service_day_cutoff_time")
    .eq("id", cityId)
    .maybeSingle();

  if (error || !data) {
    return { timezone: DEFAULT_TIMEZONE, cutoff: DEFAULT_CUTOFF };
  }

  return {
    timezone: (data as { timezone?: string; service_day_cutoff_time?: string }).timezone || DEFAULT_TIMEZONE,
    cutoff: (data as { timezone?: string; service_day_cutoff_time?: string }).service_day_cutoff_time || DEFAULT_CUTOFF,
  };
}

/**
 * Replicates resolveClosedDates from services/vipTables.ts.
 * Returns the set of dates (from the input array) that are closed for the venue.
 *
 * Logic:
 * 1. Event exists on date → open
 * 2. No event, venue_operating_hours says day is disabled → closed
 * 3. No event, no operating hours configured (0 rows) → NOT blocked (falls through)
 * 4. No event, operating hours configured, day is enabled (or not in map) → open
 */
async function resolvePricingClosedDates(
  supabase: SupabaseClient,
  venueId: string,
  dates: string[],
  city: { timezone: string; cutoff: string },
): Promise<PricingDateContext> {
  if (dates.length === 0) {
    return { closedDates: new Set(), eventByDate: new Map() };
  }

  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const windowEndExclusive = addDaysToIsoDate(lastDate, 1);
  const { startIso: windowStart, endIso: windowEnd } = serviceDateWindowToUtc(
    firstDate,
    windowEndExclusive,
    city.timezone,
    city.cutoff,
  );

  // Fetch published events in the date window
  const { data: eventRows } = await supabase
    .from("event_occurrences")
    .select("start_at,name_en,name_i18n")
    .eq("venue_id", venueId)
    .eq("published", true)
    .gte("start_at", windowStart)
    .lt("start_at", windowEnd);

  const datesWithEvents = new Set<string>();
  const eventByDate = new Map<string, string>();
  for (const row of (eventRows || []) as Array<{ start_at: string; name_en: string | null; name_i18n: unknown }>) {
    const eventDate = new Date(row.start_at);
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: city.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const localDate = formatter.format(eventDate); // YYYY-MM-DD

    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: city.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const timeParts = new Map<string, string>();
    for (const part of timeFormatter.formatToParts(eventDate)) {
      if (part.type !== "literal") {
        timeParts.set(part.type, part.value);
      }
    }
    const hour = Number(timeParts.get("hour"));
    const minute = Number(timeParts.get("minute"));
    const cutoffMatch = /^(\d{2}):(\d{2})/.exec(city.cutoff);
    const cutoffHour = cutoffMatch ? Number(cutoffMatch[1]) : 6;
    const cutoffMinute = cutoffMatch ? Number(cutoffMatch[2]) : 0;
    const beforeCutoff =
      hour < cutoffHour || (hour === cutoffHour && minute < cutoffMinute);
    const serviceDate = beforeCutoff ? addDaysToIsoDate(localDate, -1) : localDate;
    datesWithEvents.add(serviceDate);
    if (!eventByDate.has(serviceDate)) {
      eventByDate.set(serviceDate, extractEventName(row));
    }
  }

  // Fetch operating hours
  const { data: hoursRows } = await supabase
    .from("venue_operating_hours")
    .select("day_of_week,is_enabled")
    .eq("venue_id", venueId);

  const operatingHours = new Map<number, boolean>();
  for (const row of (hoursRows || []) as Array<{
    day_of_week: number;
    is_enabled: boolean;
  }>) {
    operatingHours.set(row.day_of_week, row.is_enabled);
  }

  const hasOperatingHours = operatingHours.size > 0;
  const closed = new Set<string>();

  for (const date of dates) {
    if (datesWithEvents.has(date)) {
      // Event exists → venue is open
      continue;
    }
    if (hasOperatingHours) {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (operatingHours.get(dow) === false) {
        closed.add(date);
      }
      // If day not in map or is_enabled=true → open
    }
    // No operating hours configured → don't block
  }

  return { closedDates: closed, eventByDate };
}

// ---------------------------------------------------------------------------
// Aggregation logic
// ---------------------------------------------------------------------------

function aggregatePricing(
  tables: VipVenueTableRow[],
  dayDefaults: VipTableDayDefaultRow[],
): {
  weekday_min_spend: number | null;
  weekend_min_spend: number | null;
  currency: string;
  zones: VipZonePricingSummary[];
} {
  const tableById = new Map(tables.map((t) => [t.id, t]));

  let weekdayMin: number | null = null;
  let weekendMin: number | null = null;
  let dominantCurrency = "JPY";

  // Zone-level accumulators
  const zoneMap = new Map<
    string,
    {
      capacityMins: number[];
      capacityMaxs: number[];
      weekdayMins: number[];
      weekendMins: number[];
      currency: string;
    }
  >();

  for (const row of dayDefaults) {
    const spend = coerceMinSpend(row.min_spend);
    if (spend === null) continue;

    const table = tableById.get(row.vip_venue_table_id);
    const zone = table?.zone ?? "General";
    const currency = row.currency ?? "JPY";
    dominantCurrency = currency;

    if (!zoneMap.has(zone)) {
      zoneMap.set(zone, {
        capacityMins: [],
        capacityMaxs: [],
        weekdayMins: [],
        weekendMins: [],
        currency,
      });
    }
    const zd = zoneMap.get(zone)!;

    // Accumulate capacity bounds from the table (deduplicate by adding each bound once per zone)
    if (table?.capacity_min != null) zd.capacityMins.push(table.capacity_min);
    if (table?.capacity_max != null) zd.capacityMaxs.push(table.capacity_max);

    if (isWeekend(row.day_of_week)) {
      weekendMin = weekendMin === null ? spend : Math.min(weekendMin, spend);
      zd.weekendMins.push(spend);
    } else {
      weekdayMin = weekdayMin === null ? spend : Math.min(weekdayMin, spend);
      zd.weekdayMins.push(spend);
    }
  }

  const zones: VipZonePricingSummary[] = Array.from(zoneMap.entries()).map(
    ([zone, zd]) => ({
      zone,
      capacity_min: zd.capacityMins.length > 0 ? Math.min(...zd.capacityMins) : null,
      capacity_max: zd.capacityMaxs.length > 0 ? Math.max(...zd.capacityMaxs) : null,
      weekday_min_spend: zd.weekdayMins.length > 0 ? Math.min(...zd.weekdayMins) : null,
      weekend_min_spend: zd.weekendMins.length > 0 ? Math.min(...zd.weekendMins) : null,
      currency: zd.currency,
    }),
  );

  return { weekday_min_spend: weekdayMin, weekend_min_spend: weekendMin, currency: dominantCurrency, zones };
}

// ---------------------------------------------------------------------------
// Main service function
// ---------------------------------------------------------------------------

export async function getVipPricing(
  supabase: SupabaseClient,
  input: GetVipPricingInput,
): Promise<VipPricingResult> {
  // 1. Validate UUID
  const venueId = ensureUuid(input.venue_id, "venue_id");

  // 2. Resolve venue
  const venue = await resolveVenueForPricing(supabase, venueId);
  const venueName = venue.name;

  // 3. Resolve city context
  const city = await fetchPricingCityContext(supabase, venue.city_id);

  // 4. Determine service date (null when no date requested)
  let serviceDate: string | null = null;
  const dateInput = input.date?.trim().toLowerCase();
  if (dateInput === "tonight") {
    serviceDate = getCurrentServiceDate(new Date(), city.timezone, city.cutoff);
  } else if (dateInput && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    serviceDate = dateInput;
  }
  // When no date provided: serviceDate stays null — return general pricing only

  // 5. Run open-day check (only when a specific date was requested)
  let venueOpen: boolean | null = null;
  let venueClosedMessage: string | null = null;
  let eventName: string | null = null;
  if (serviceDate) {
    const { closedDates, eventByDate } = await resolvePricingClosedDates(supabase, venueId, [serviceDate], city);
    venueOpen = !closedDates.has(serviceDate);
    venueClosedMessage = venueOpen
      ? null
      : `${venueName || "This venue"} appears to be closed on ${serviceDate}.`;
    eventName = eventByDate.get(serviceDate) ?? null;
  }

  // 6. Fetch active vip_venue_tables
  const { data: tableData, error: tableError } = await supabase
    .from("vip_venue_tables")
    .select("id,table_code,table_name,metadata,zone,capacity_min,capacity_max")
    .eq("venue_id", venueId)
    .eq("is_active", true);

  if (tableError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP venue tables.", {
      cause: tableError.message,
    });
  }

  const tables = (tableData || []) as VipVenueTableRow[];

  // 7. Fetch ALL vip_table_day_defaults for venue
  const { data: dayDefaultData, error: dayDefaultError } = await supabase
    .from("vip_table_day_defaults")
    .select("vip_venue_table_id,day_of_week,min_spend,currency,note")
    .eq("venue_id", venueId);

  if (dayDefaultError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP table day defaults.", {
      cause: dayDefaultError.message,
    });
  }

  const dayDefaults = (dayDefaultData || []) as VipTableDayDefaultRow[];

  // 8. Check per-date overrides from vip_table_availability
  let eventPricingNote: string | null = null;
  const { data: dateOverrideData } = await supabase
    .from("vip_table_availability")
    .select("min_spend")
    .eq("venue_id", venueId)
    .eq("booking_date", serviceDate);

  const overrideRows = (dateOverrideData || []) as Array<{ min_spend: number | string | null }>;
  const hasOverridesWithPricing = overrideRows.some((r) => coerceMinSpend(r.min_spend) !== null);
  if (hasOverridesWithPricing) {
    eventPricingNote = `Special event pricing may apply on ${serviceDate} — actual minimums may differ from the general ranges shown.`;
  }

  // 9. Aggregate pricing
  const aggregated = aggregatePricing(tables, dayDefaults);

  // 10. Determine pricing_configured and pricing_approximate
  const venueDefaultMinSpend = coerceMinSpend(venue.vip_default_min_spend);
  const pricingConfigured = dayDefaults.length > 0 || venueDefaultMinSpend !== null;
  const pricingNotConfiguredMessage = pricingConfigured
    ? null
    : "VIP pricing information is not yet available for this venue.";
  const pricingApproximate = dayDefaults.length === 0 && venueDefaultMinSpend !== null;

  // 11. Extract layout_image_url
  const layoutImageUrl =
    tables.map((t) => extractLayoutImageUrl(t.metadata)).find(Boolean) || null;

  // 12. Determine booking fields
  const bookingSupported = venue.vip_booking_enabled === true;

  // 13. Return result
  const busyNight = eventName !== null;
  return {
    venue_id: venueId,
    venue_name: venueName,
    venue_open: venueOpen === null ? true : venueOpen,
    venue_closed_message: venueClosedMessage,
    pricing_configured: pricingConfigured,
    pricing_not_configured_message: pricingNotConfiguredMessage,
    weekday_min_spend: aggregated.weekday_min_spend,
    weekend_min_spend: aggregated.weekend_min_spend,
    currency: aggregated.currency,
    zones: aggregated.zones,
    layout_image_url: layoutImageUrl,
    booking_supported: bookingSupported,
    booking_note: null,
    generated_at: new Date().toISOString(),
    service_date: serviceDate,
    event_pricing_note: eventPricingNote,
    event_name: eventName,
    busy_night: busyNight,
    pricing_approximate: pricingApproximate,
  };
}
