import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDateWindowToUtc, addDaysToIsoDate } from "../utils/time.js";
import {
  type VipTableAvailabilityMutationResult,
  type VipTableAvailabilityResult,
  type VipTableChartResult,
  type VipTableChartImageUploadResult,
  type VipTableDayDefaultMutationResult,
  type VipTableStatus,
  type VipVenueTableMutationResult,
} from "../types.js";
import { NightlifeError } from "../errors.js";

export type GetVipTableAvailabilityInput = {
  venue_id: string;
  booking_date_from: string;
  booking_date_to?: string;
  party_size?: number;
  include_non_available?: boolean;
};

export type GetVipTableChartInput = {
  venue_id: string;
  booking_date?: string;
  include_inactive?: boolean;
};

export type UpsertVipVenueTablesInput = {
  venue_id: string;
  layout_image_url?: string;
  tables: Array<{
    table_code: string;
    table_name?: string;
    note?: string;
    zone?: string;
    capacity_min?: number;
    capacity_max?: number;
    is_active?: boolean;
    default_status?: VipTableStatus;
    chart_shape?: string;
    chart_x?: number;
    chart_y?: number;
    chart_width?: number;
    chart_height?: number;
    chart_rotation?: number;
    sort_order?: number;
  }>;
};

export type UpsertVipTableAvailabilityInput = {
  venue_id: string;
  booking_date: string;
  tables: Array<{
    table_code: string;
    status: VipTableStatus;
    min_spend?: number;
    currency?: string;
    note?: string;
  }>;
};

export type UpsertVipTableDayDefaultsInput = {
  venue_id: string;
  tables: Array<{
    table_code: string;
    days: Array<{
      day_of_week: number;
      default_status?: string;
      min_spend?: number;
      currency?: string;
      note?: string;
    }>;
  }>;
};

export type UploadVipTableChartImageInput = {
  venue_id: string;
  image_base64: string;
  mime_type: string;
  filename?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const TABLE_CODE_RE = /^[A-Z0-9._-]{1,64}$/;
const HTTP_URL_RE = /^https?:\/\/\S+$/i;
const FILE_STEM_RE = /[^a-z0-9._-]/g;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const VIP_TABLE_CHARTS_BUCKET = "vip-table-charts";
const VIP_TABLE_CHART_MAX_BYTES = 10 * 1024 * 1024;
const VIP_TABLE_CHART_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

const VIP_TABLE_STATUSES: VipTableStatus[] = [
  "available",
  "held",
  "booked",
  "blocked",
  "unknown",
];
const VIP_TABLE_SHAPES = ["rectangle", "circle", "booth", "standing"] as const;

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
  is_active: boolean;
  default_status: string;
  chart_shape: string;
  chart_x: number | string | null;
  chart_y: number | string | null;
  chart_width: number | string | null;
  chart_height: number | string | null;
  chart_rotation: number | string | null;
  sort_order: number;
};

type VipTableAvailabilityRow = {
  vip_venue_table_id: string;
  booking_date: string;
  status: string;
  min_spend: number | string | null;
  currency: string | null;
  note: string | null;
};

type VipTableDayDefaultRow = {
  vip_venue_table_id: string;
  day_of_week: number;
  default_status: string;
  min_spend: number | string | null;
  currency: string | null;
  note: string | null;
};

function ensureUuid(input: string, field: string): string {
  const normalized = String(input || "").trim();
  if (!UUID_RE.test(normalized)) {
    throw new NightlifeError("INVALID_REQUEST", `${field} must be a valid UUID.`);
  }
  return normalized;
}

function normalizeIsoDate(input: string, field: string): string {
  const normalized = String(input || "").trim();
  if (!ISO_DATE_RE.test(normalized)) {
    throw new NightlifeError("INVALID_REQUEST", `${field} must use YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new NightlifeError("INVALID_REQUEST", `${field} must be a valid calendar date.`);
  }
  return normalized;
}

function normalizeDateRange(fromRaw: string, toRaw?: string): { from: string; to: string } {
  const from = normalizeIsoDate(fromRaw, "booking_date_from");
  const to = normalizeIsoDate(toRaw || from, "booking_date_to");

  if (from > to) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "booking_date_from cannot be after booking_date_to.",
    );
  }

  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  const dayDiff = Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000));
  if (dayDiff > 30) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "booking_date range cannot exceed 31 days (from same-day to +30).",
    );
  }

  return { from, to };
}

function normalizePartySize(input: number | undefined): number | null {
  if (input === undefined) {
    return null;
  }
  if (!Number.isInteger(input) || input < 1 || input > 30) {
    throw new NightlifeError("INVALID_REQUEST", "party_size must be an integer between 1 and 30.");
  }
  return input;
}

function normalizeTableCode(input: string): string {
  const normalized = String(input || "").trim().toUpperCase();
  if (!TABLE_CODE_RE.test(normalized)) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "table_code must be alphanumeric and can include '-', '_', or '.'.",
    );
  }
  return normalized;
}

function normalizeTableName(input: string | undefined, tableCode: string): string {
  const normalized = String(input || "").trim();
  return normalized || tableCode;
}

function normalizeTableStatus(input: string, field: string): VipTableStatus {
  const normalized = String(input || "").trim().toLowerCase();
  if (!VIP_TABLE_STATUSES.includes(normalized as VipTableStatus)) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      `${field} must be one of: ${VIP_TABLE_STATUSES.join(", ")}.`,
    );
  }
  return normalized as VipTableStatus;
}

function normalizeCurrency(input: string | undefined): string | null {
  const normalized = String(input || "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (!CURRENCY_RE.test(normalized)) {
    throw new NightlifeError("INVALID_REQUEST", "currency must be a 3-letter ISO code.");
  }
  return normalized;
}

function normalizeAmount(input: number | undefined, field: string): number | null {
  if (input === undefined) {
    return null;
  }
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    throw new NightlifeError("INVALID_REQUEST", `${field} must be a non-negative number.`);
  }
  return Math.round(input * 100) / 100;
}

function normalizeCapacity(
  minRaw: number | undefined,
  maxRaw: number | undefined,
): { min: number; max: number } {
  const min = minRaw === undefined ? 1 : minRaw;
  const max = maxRaw === undefined ? Math.max(min, 12) : maxRaw;

  if (!Number.isInteger(min) || min < 1) {
    throw new NightlifeError("INVALID_REQUEST", "capacity_min must be an integer >= 1.");
  }
  if (!Number.isInteger(max) || max < 1) {
    throw new NightlifeError("INVALID_REQUEST", "capacity_max must be an integer >= 1.");
  }
  if (min > max) {
    throw new NightlifeError("INVALID_REQUEST", "capacity_min cannot be greater than capacity_max.");
  }

  return { min, max };
}

function normalizeSortOrder(input: number | undefined, fallback: number): number {
  if (input === undefined) {
    return fallback;
  }
  if (!Number.isInteger(input)) {
    throw new NightlifeError("INVALID_REQUEST", "sort_order must be an integer.");
  }
  return input;
}

function normalizeOptionalText(
  input: string | undefined,
  field: string,
  maxLength: number,
): string | null {
  const normalized = String(input || "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new NightlifeError("INVALID_REQUEST", `${field} cannot exceed ${maxLength} characters.`);
  }
  return normalized;
}

function normalizeOptionalHttpUrl(input: string | undefined, field: string): string | null {
  const normalized = String(input || "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > 2048) {
    throw new NightlifeError("INVALID_REQUEST", `${field} cannot exceed 2048 characters.`);
  }
  if (!HTTP_URL_RE.test(normalized)) {
    throw new NightlifeError("INVALID_REQUEST", `${field} must be an http/https URL.`);
  }
  return normalized;
}

function normalizeMimeType(input: string): string {
  const normalized = String(input || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(VIP_TABLE_CHART_MIME_EXT, normalized)) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      `mime_type must be one of: ${Object.keys(VIP_TABLE_CHART_MIME_EXT).join(", ")}.`,
    );
  }
  return normalized;
}

function normalizeImageBase64(input: string): Buffer {
  const raw = String(input || "").trim();
  if (!raw) {
    throw new NightlifeError("INVALID_REQUEST", "image_base64 is required.");
  }

  const base64 = raw.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (!BASE64_RE.test(base64)) {
    throw new NightlifeError("INVALID_REQUEST", "image_base64 must be valid base64 data.");
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    throw new NightlifeError("INVALID_REQUEST", "image_base64 must be valid base64 data.");
  }

  if (bytes.length === 0) {
    throw new NightlifeError("INVALID_REQUEST", "image_base64 decoded to an empty payload.");
  }
  if (bytes.length > VIP_TABLE_CHART_MAX_BYTES) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      `Image size exceeds ${VIP_TABLE_CHART_MAX_BYTES} bytes.`,
    );
  }

  return bytes;
}

function normalizeFileStem(input: string | undefined): string {
  const normalized = String(input || "").trim().toLowerCase();
  if (!normalized) {
    return "layout";
  }

  const noExtension = normalized.replace(/\.[a-z0-9]+$/i, "");
  const compact = noExtension.replace(FILE_STEM_RE, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return compact.slice(0, 64) || "layout";
}

function normalizeChartShape(input: string | undefined): string {
  const normalized = String(input || "").trim().toLowerCase();
  if (!normalized) {
    return "rectangle";
  }
  if (!VIP_TABLE_SHAPES.includes(normalized as (typeof VIP_TABLE_SHAPES)[number])) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      `chart_shape must be one of: ${VIP_TABLE_SHAPES.join(", ")}.`,
    );
  }
  return normalized;
}

function normalizeOptionalNumber(input: number | undefined, field: string): number | null {
  if (input === undefined) {
    return null;
  }
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new NightlifeError("INVALID_REQUEST", `${field} must be a valid number.`);
  }
  return Math.round(input * 100) / 100;
}

function numberOrNull(input: number | string | null): number | null {
  if (input === null || input === undefined) {
    return null;
  }
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function objectOrEmpty(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return { ...(input as Record<string, unknown>) };
}

function extractDefaultTableNote(metadata: unknown): string | null {
  const obj = objectOrEmpty(metadata);
  const value = obj.table_note;
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
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

function isVipTableStatus(value: string): value is VipTableStatus {
  return VIP_TABLE_STATUSES.includes(value as VipTableStatus);
}

function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function fetchTableDayDefaults(
  supabase: SupabaseClient,
  venueId: string,
): Promise<Map<string, VipTableDayDefaultRow>> {
  const { data, error } = await supabase
    .from("vip_table_day_defaults")
    .select("vip_venue_table_id,day_of_week,default_status,min_spend,currency,note")
    .eq("venue_id", venueId);

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP table day defaults.", {
      cause: error.message,
    });
  }

  const map = new Map<string, VipTableDayDefaultRow>();
  for (const row of (data || []) as VipTableDayDefaultRow[]) {
    map.set(`${row.vip_venue_table_id}:${row.day_of_week}`, row);
  }
  return map;
}

async function fetchCityContext(
  supabase: SupabaseClient,
  cityId: string,
): Promise<{ timezone: string; cutoff: string } | null> {
  const { data, error } = await supabase
    .from("cities")
    .select("timezone,service_day_cutoff_time")
    .eq("id", cityId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    timezone: data.timezone || "Asia/Tokyo",
    cutoff: data.service_day_cutoff_time || "06:00",
  };
}

async function resolveClosedDates(
  supabase: SupabaseClient,
  venueId: string,
  dates: string[],
  city: { timezone: string; cutoff: string },
): Promise<Set<string>> {
  if (dates.length === 0) {
    return new Set();
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

  // Fetch published events in the date range
  const { data: eventRows } = await supabase
    .from("event_occurrences")
    .select("start_at")
    .eq("venue_id", venueId)
    .eq("published", true)
    .gte("start_at", windowStart)
    .lt("start_at", windowEnd);

  const datesWithEvents = new Set<string>();
  for (const row of (eventRows || []) as Array<{ start_at: string }>) {
    // Convert UTC start_at back to a service date in the venue's timezone
    const eventDate = new Date(row.start_at);
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: city.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const localDate = formatter.format(eventDate); // YYYY-MM-DD
    // Check if before cutoff → previous service date
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
  }

  // Fetch operating hours (up to 7 rows)
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
      // If day_of_week not in map or is_enabled=true → open
    }
    // No operating hours configured → don't block (fall through to existing logic)
  }

  return closed;
}

async function resolveVenue(
  supabase: SupabaseClient,
  venueId: string,
  requireVipEnabled: boolean,
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
  if (requireVipEnabled && data.vip_booking_enabled !== true) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "VIP booking is not currently enabled for this venue.",
    );
  }
  return data;
}

async function fetchVenueTables(
  supabase: SupabaseClient,
  venueId: string,
  includeInactive: boolean,
): Promise<VipVenueTableRow[]> {
  let query = supabase
    .from("vip_venue_tables")
    .select(
      "id,table_code,table_name,metadata,zone,capacity_min,capacity_max,is_active,default_status,chart_shape,chart_x,chart_y,chart_width,chart_height,chart_rotation,sort_order",
    )
    .eq("venue_id", venueId);

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("table_code", { ascending: true });

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP venue tables.", {
      cause: error.message,
    });
  }
  return (data || []) as VipVenueTableRow[];
}

async function applyLayoutImageUrlToVenueTables(
  supabase: SupabaseClient,
  venueId: string,
  layoutImageUrl: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("vip_venue_tables")
    .select("id,metadata")
    .eq("venue_id", venueId);

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP venue tables for layout image.", {
      cause: error.message,
    });
  }

  const rows = (data || []) as Array<{ id: string; metadata: unknown }>;
  if (rows.length === 0) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "Cannot attach layout image before venue tables exist. Create VIP tables first.",
    );
  }

  for (const row of rows) {
    const metadata = {
      ...objectOrEmpty(row.metadata),
      layout_image_url: layoutImageUrl,
    };

    const { error: updateError } = await supabase
      .from("vip_venue_tables")
      .update({ metadata })
      .eq("id", row.id);

    if (updateError) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to save layout image metadata.", {
        cause: updateError.message,
      });
    }
  }

  return rows.length;
}

export async function getVipTableAvailability(
  supabase: SupabaseClient,
  input: GetVipTableAvailabilityInput,
): Promise<VipTableAvailabilityResult> {
  const venueId = ensureUuid(input.venue_id, "venue_id");
  const range = normalizeDateRange(input.booking_date_from, input.booking_date_to);
  const partySize = normalizePartySize(input.party_size);
  const includeNonAvailable = input.include_non_available === true;
  const nowIso = new Date().toISOString();

  const venue = await resolveVenue(supabase, venueId, true);
  const tables = await fetchVenueTables(supabase, venueId, false);
  const candidateTables = tables.filter((table) => {
    if (partySize === null) {
      return true;
    }

    const min = table.capacity_min ?? 1;
    const max = table.capacity_max ?? 999;
    return min <= partySize && max >= partySize;
  });

  const dates = enumerateDates(range.from, range.to);

  // Determine which dates the venue is closed
  const city = venue.city_id ? await fetchCityContext(supabase, venue.city_id) : null;
  const closedDates = city
    ? await resolveClosedDates(supabase, venueId, dates, city)
    : new Set<string>();

  const tableIds = candidateTables.map((table) => table.id);

  const availabilityByKey = new Map<string, VipTableAvailabilityRow>();
  if (tableIds.length > 0) {
    const { data: availabilityRows, error: availabilityError } = await supabase
      .from("vip_table_availability")
      .select("vip_venue_table_id,booking_date,status,min_spend,currency,note")
      .eq("venue_id", venueId)
      .in("vip_venue_table_id", tableIds)
      .gte("booking_date", range.from)
      .lte("booking_date", range.to);

    if (availabilityError) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP table availability.", {
        cause: availabilityError.message,
      });
    }

    for (const row of (availabilityRows || []) as VipTableAvailabilityRow[]) {
      availabilityByKey.set(`${row.booking_date}:${row.vip_venue_table_id}`, row);
    }
  }

  const dayDefaults = await fetchTableDayDefaults(supabase, venueId);

  const days = dates.map((bookingDate) => {
    // Venue closed pre-check — all tables blocked
    if (closedDates.has(bookingDate)) {
      const blockedTables = candidateTables.map((table) => ({
        table_id: table.id,
        table_code: table.table_code,
        table_name: table.table_name,
        zone: table.zone,
        capacity_min: table.capacity_min,
        capacity_max: table.capacity_max,
        status: "blocked" as VipTableStatus,
        min_spend: null,
        currency: null,
        note: "Venue closed",
        pricing_approximate: false,
      }));
      return {
        booking_date: bookingDate,
        venue_open: false,
        available_count: 0,
        total_count: blockedTables.length,
        tables: includeNonAvailable ? blockedTables : [],
      };
    }

    const tableStatuses = candidateTables.map((table) => {
      const row = availabilityByKey.get(`${bookingDate}:${table.id}`);
      const defaultTableNote = extractDefaultTableNote(table.metadata);

      let status: VipTableStatus;
      let min_spend: number | null;
      let currency: string | null;
      let note: string | null;
      let pricingApproximate: boolean;

      if (row && isVipTableStatus(String(row.status))) {
        // Level 1: Explicit per-date row — exact pricing
        status = row.status as VipTableStatus;
        min_spend = numberOrNull(row.min_spend);
        currency = row.currency || null;
        note = row.note || defaultTableNote;
        pricingApproximate = false;
      } else {
        const dayOfWeek = new Date(`${bookingDate}T00:00:00Z`).getUTCDay();
        const dayDefault = dayDefaults.get(`${table.id}:${dayOfWeek}`);

        if (dayDefault) {
          // Level 2: Per-table day-of-week template
          status = isVipTableStatus(dayDefault.default_status)
            ? dayDefault.default_status as VipTableStatus
            : "available";
          min_spend = numberOrNull(dayDefault.min_spend);
          currency = dayDefault.currency || null;
          note = dayDefault.note || defaultTableNote;
          pricingApproximate = false;
        } else if (venue.vip_default_min_spend != null) {
          // Level 3: Venue-level minimum table price (approximate)
          status = isVipTableStatus(table.default_status)
            ? table.default_status as VipTableStatus
            : "available";
          min_spend = numberOrNull(venue.vip_default_min_spend);
          currency = venue.vip_default_currency || "JPY";
          note = defaultTableNote;
          pricingApproximate = true;
        } else {
          // Level 4: No pricing data (backward compat)
          status = isVipTableStatus(table.default_status)
            ? table.default_status as VipTableStatus
            : "unknown";
          min_spend = null;
          currency = null;
          note = defaultTableNote;
          pricingApproximate = false;
        }
      }

      return {
        table_id: table.id,
        table_code: table.table_code,
        table_name: table.table_name,
        zone: table.zone,
        capacity_min: table.capacity_min,
        capacity_max: table.capacity_max,
        status,
        min_spend,
        currency,
        note,
        pricing_approximate: pricingApproximate,
      };
    });

    const availableCount = tableStatuses.filter((table) => table.status === "available").length;
    const visibleTables = includeNonAvailable
      ? tableStatuses
      : tableStatuses.filter((table) => table.status === "available");

    return {
      booking_date: bookingDate,
      venue_open: true,
      available_count: availableCount,
      total_count: tableStatuses.length,
      tables: visibleTables,
    };
  });

  return {
    venue_id: venue.id,
    venue_name: venue.name,
    booking_date_from: range.from,
    booking_date_to: range.to,
    party_size: partySize,
    generated_at: nowIso,
    days,
  };
}

export async function getVipTableChart(
  supabase: SupabaseClient,
  input: GetVipTableChartInput,
): Promise<VipTableChartResult> {
  const venueId = ensureUuid(input.venue_id, "venue_id");
  const bookingDate = input.booking_date
    ? normalizeIsoDate(input.booking_date, "booking_date")
    : null;
  const includeInactive = input.include_inactive === true;
  const nowIso = new Date().toISOString();

  const venue = await resolveVenue(supabase, venueId, true);
  const tables = await fetchVenueTables(supabase, venueId, includeInactive);

  // Determine if venue is closed on the requested date
  const city = venue.city_id ? await fetchCityContext(supabase, venue.city_id) : null;
  const isDateClosed = bookingDate && city
    ? (await resolveClosedDates(supabase, venueId, [bookingDate], city)).has(bookingDate)
    : false;

  // If venue is closed, all tables get blocked status
  if (isDateClosed) {
    const blockedTables = tables.map((table) => ({
      table_id: table.id,
      table_code: table.table_code,
      table_name: table.table_name,
      zone: table.zone,
      capacity_min: table.capacity_min,
      capacity_max: table.capacity_max,
      is_active: table.is_active,
      sort_order: table.sort_order,
      chart_shape: table.chart_shape,
      chart_x: numberOrNull(table.chart_x),
      chart_y: numberOrNull(table.chart_y),
      chart_width: numberOrNull(table.chart_width),
      chart_height: numberOrNull(table.chart_height),
      chart_rotation: numberOrNull(table.chart_rotation),
      status: "blocked" as VipTableStatus,
      min_spend: null,
      currency: null,
      note: "Venue closed",
      pricing_approximate: false,
    }));

    return {
      venue_id: venue.id,
      venue_name: venue.name,
      venue_open: false,
      booking_date: bookingDate,
      layout_image_url:
        tables.map((table) => extractLayoutImageUrl(table.metadata)).find(Boolean) || null,
      generated_at: nowIso,
      tables: blockedTables,
    };
  }

  const availabilityByTableId = new Map<string, VipTableAvailabilityRow>();
  if (bookingDate && tables.length > 0) {
    const tableIds = tables.map((table) => table.id);
    const { data: rows, error } = await supabase
      .from("vip_table_availability")
      .select("vip_venue_table_id,booking_date,status,min_spend,currency,note")
      .eq("venue_id", venueId)
      .eq("booking_date", bookingDate)
      .in("vip_venue_table_id", tableIds);

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to load table chart availability.", {
        cause: error.message,
      });
    }

    for (const row of (rows || []) as VipTableAvailabilityRow[]) {
      availabilityByTableId.set(row.vip_venue_table_id, row);
    }
  }

  const dayDefaults = bookingDate
    ? await fetchTableDayDefaults(supabase, venueId)
    : new Map<string, VipTableDayDefaultRow>();

  const chartTables = tables.map((table) => {
    const row = bookingDate ? availabilityByTableId.get(table.id) : null;
    const defaultTableNote = extractDefaultTableNote(table.metadata);

    let status: VipTableStatus | null;
    let min_spend: number | null;
    let currency: string | null;
    let note: string | null;
    let pricingApproximate: boolean;

    if (!bookingDate) {
      // No booking date — chart-only view, no status/pricing
      status = null;
      min_spend = null;
      currency = null;
      note = defaultTableNote;
      pricingApproximate = false;
    } else if (row && isVipTableStatus(String(row.status))) {
      // Level 1: Explicit per-date row
      status = row.status as VipTableStatus;
      min_spend = numberOrNull(row.min_spend);
      currency = row.currency || null;
      note = row.note || defaultTableNote;
      pricingApproximate = false;
    } else {
      const dayOfWeek = new Date(`${bookingDate}T00:00:00Z`).getUTCDay();
      const dayDefault = dayDefaults.get(`${table.id}:${dayOfWeek}`);

      if (dayDefault) {
        // Level 2: Per-table day-of-week template
        status = isVipTableStatus(dayDefault.default_status)
          ? dayDefault.default_status as VipTableStatus
          : "available";
        min_spend = numberOrNull(dayDefault.min_spend);
        currency = dayDefault.currency || null;
        note = dayDefault.note || defaultTableNote;
        pricingApproximate = false;
      } else if (venue.vip_default_min_spend != null) {
        // Level 3: Venue-level minimum table price (approximate)
        status = isVipTableStatus(table.default_status)
          ? table.default_status as VipTableStatus
          : "available";
        min_spend = numberOrNull(venue.vip_default_min_spend);
        currency = venue.vip_default_currency || "JPY";
        note = defaultTableNote;
        pricingApproximate = true;
      } else {
        // Level 4: No pricing data (backward compat)
        status = isVipTableStatus(table.default_status)
          ? table.default_status as VipTableStatus
          : "unknown";
        min_spend = null;
        currency = null;
        note = defaultTableNote;
        pricingApproximate = false;
      }
    }

    return {
      table_id: table.id,
      table_code: table.table_code,
      table_name: table.table_name,
      zone: table.zone,
      capacity_min: table.capacity_min,
      capacity_max: table.capacity_max,
      is_active: table.is_active,
      sort_order: table.sort_order,
      chart_shape: table.chart_shape,
      chart_x: numberOrNull(table.chart_x),
      chart_y: numberOrNull(table.chart_y),
      chart_width: numberOrNull(table.chart_width),
      chart_height: numberOrNull(table.chart_height),
      chart_rotation: numberOrNull(table.chart_rotation),
      status,
      min_spend,
      currency,
      note,
      pricing_approximate: pricingApproximate,
    };
  });

  return {
    venue_id: venue.id,
    venue_name: venue.name,
    venue_open: bookingDate ? true : null,
    booking_date: bookingDate,
    layout_image_url:
      tables.map((table) => extractLayoutImageUrl(table.metadata)).find(Boolean) || null,
    generated_at: nowIso,
    tables: chartTables,
  };
}

export async function upsertVipVenueTables(
  supabase: SupabaseClient,
  input: UpsertVipVenueTablesInput,
): Promise<VipVenueTableMutationResult> {
  const venueId = ensureUuid(input.venue_id, "venue_id");
  const rowsRaw = Array.isArray(input.tables) ? input.tables : [];
  if (rowsRaw.length === 0) {
    throw new NightlifeError("INVALID_REQUEST", "tables must include at least one table definition.");
  }
  if (rowsRaw.length > 200) {
    throw new NightlifeError("INVALID_REQUEST", "tables cannot exceed 200 items per request.");
  }

  const venue = await resolveVenue(supabase, venueId, false);
  const layoutImageUrl = normalizeOptionalHttpUrl(input.layout_image_url, "layout_image_url");
  const rowsNormalized = rowsRaw.map((table, index) => {
    const tableCode = normalizeTableCode(table.table_code);
    const { min, max } = normalizeCapacity(table.capacity_min, table.capacity_max);
    return {
      venue_id: venueId,
      table_code: tableCode,
      table_note: table.note !== undefined
        ? normalizeOptionalText(table.note, "note", 500)
        : undefined,
      table_name: normalizeTableName(table.table_name, tableCode),
      zone: normalizeOptionalText(table.zone, "zone", 120),
      capacity_min: min,
      capacity_max: max,
      is_active: table.is_active !== false,
      default_status: normalizeTableStatus(table.default_status || "unknown", "default_status"),
      chart_shape: normalizeChartShape(table.chart_shape),
      chart_x: normalizeOptionalNumber(table.chart_x, "chart_x"),
      chart_y: normalizeOptionalNumber(table.chart_y, "chart_y"),
      chart_width: normalizeOptionalNumber(table.chart_width, "chart_width"),
      chart_height: normalizeOptionalNumber(table.chart_height, "chart_height"),
      chart_rotation: normalizeOptionalNumber(table.chart_rotation, "chart_rotation"),
      sort_order: normalizeSortOrder(table.sort_order, index),
    };
  });

  const tableCodes = [...new Set(rowsNormalized.map((row) => row.table_code))];
  const { data: existingRows, error: existingRowsError } = await supabase
    .from("vip_venue_tables")
    .select("table_code,metadata")
    .eq("venue_id", venueId)
    .in("table_code", tableCodes);

  if (existingRowsError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load existing table metadata.", {
      cause: existingRowsError.message,
    });
  }

  const metadataByCode = new Map<string, Record<string, unknown>>();
  for (const row of (existingRows || []) as Array<{ table_code: string; metadata: unknown }>) {
    metadataByCode.set(String(row.table_code).toUpperCase(), objectOrEmpty(row.metadata));
  }

  const rows = rowsNormalized.map((row) => {
    const existingMetadata = metadataByCode.get(row.table_code) || {};
    const metadata = { ...existingMetadata };
    if (row.table_note !== undefined) {
      if (row.table_note) {
        metadata.table_note = row.table_note;
      } else {
        delete metadata.table_note;
      }
    }
    if (layoutImageUrl) {
      metadata.layout_image_url = layoutImageUrl;
    }

    return {
      venue_id: row.venue_id,
      table_code: row.table_code,
      table_name: row.table_name,
      zone: row.zone,
      capacity_min: row.capacity_min,
      capacity_max: row.capacity_max,
      is_active: row.is_active,
      default_status: row.default_status,
      chart_shape: row.chart_shape,
      chart_x: row.chart_x,
      chart_y: row.chart_y,
      chart_width: row.chart_width,
      chart_height: row.chart_height,
      chart_rotation: row.chart_rotation,
      sort_order: row.sort_order,
      metadata,
    };
  });

  const { data, error } = await supabase
    .from("vip_venue_tables")
    .upsert(rows, { onConflict: "venue_id,table_code" })
    .select("id,table_code");

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to upsert VIP venue tables.", {
      cause: error.message,
    });
  }

  const resultRows = Array.isArray(data)
    ? (data as Array<{ id: string; table_code: string }>)
    : [];

  return {
    venue_id: venue.id,
    venue_name: venue.name,
    updated_count: rows.length,
    tables: resultRows.map((row) => ({
      table_id: row.id,
      table_code: row.table_code,
    })),
  };
}

export async function upsertVipTableAvailability(
  supabase: SupabaseClient,
  input: UpsertVipTableAvailabilityInput,
): Promise<VipTableAvailabilityMutationResult> {
  const venueId = ensureUuid(input.venue_id, "venue_id");
  const bookingDate = normalizeIsoDate(input.booking_date, "booking_date");
  const rowsRaw = Array.isArray(input.tables) ? input.tables : [];
  if (rowsRaw.length === 0) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "tables must include at least one availability entry.",
    );
  }
  if (rowsRaw.length > 300) {
    throw new NightlifeError("INVALID_REQUEST", "tables cannot exceed 300 items per request.");
  }

  const venue = await resolveVenue(supabase, venueId, false);
  const normalizedRows = rowsRaw.map((entry) => ({
    table_code: normalizeTableCode(entry.table_code),
    status: normalizeTableStatus(entry.status, "status"),
    min_spend: normalizeAmount(entry.min_spend, "min_spend"),
    currency: normalizeCurrency(entry.currency),
    note: normalizeOptionalText(entry.note, "note", 500),
  }));

  const tableCodes = [...new Set(normalizedRows.map((row) => row.table_code))];
  const { data: tableRows, error: tableError } = await supabase
    .from("vip_venue_tables")
    .select("id,table_code")
    .eq("venue_id", venueId)
    .in("table_code", tableCodes);

  if (tableError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load venue table IDs.", {
      cause: tableError.message,
    });
  }

  const tableIdByCode = new Map<string, string>();
  for (const row of (tableRows || []) as Array<{ id: string; table_code: string }>) {
    tableIdByCode.set(String(row.table_code).toUpperCase(), row.id);
  }

  const missingCodes = tableCodes.filter((code) => !tableIdByCode.has(code));
  if (missingCodes.length > 0) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      `Unknown table_code for venue: ${missingCodes.join(", ")}.`,
    );
  }

  const upserts = normalizedRows.map((row) => ({
    venue_id: venueId,
    vip_venue_table_id: tableIdByCode.get(row.table_code),
    booking_date: bookingDate,
    status: row.status,
    min_spend: row.min_spend,
    currency: row.currency,
    note: row.note,
  }));

  const { error } = await supabase
    .from("vip_table_availability")
    .upsert(upserts, { onConflict: "vip_venue_table_id,booking_date" });

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to upsert VIP table availability.", {
      cause: error.message,
    });
  }

  return {
    venue_id: venue.id,
    venue_name: venue.name,
    booking_date: bookingDate,
    updated_count: upserts.length,
  };
}

export async function upsertVipTableDayDefaults(
  supabase: SupabaseClient,
  input: UpsertVipTableDayDefaultsInput,
): Promise<VipTableDayDefaultMutationResult> {
  const venueId = ensureUuid(input.venue_id, "venue_id");
  const tablesRaw = Array.isArray(input.tables) ? input.tables : [];
  if (tablesRaw.length === 0) {
    throw new NightlifeError("INVALID_REQUEST", "tables must include at least one table entry.");
  }
  if (tablesRaw.length > 200) {
    throw new NightlifeError("INVALID_REQUEST", "tables cannot exceed 200 items per request.");
  }

  const venue = await resolveVenue(supabase, venueId, false);

  // Collect all table codes and validate days
  const normalizedTables = tablesRaw.map((t) => {
    const tableCode = normalizeTableCode(t.table_code);
    const days = Array.isArray(t.days) ? t.days : [];
    if (days.length === 0) {
      throw new NightlifeError("INVALID_REQUEST", `Table ${tableCode}: days must include at least one entry.`);
    }
    if (days.length > 7) {
      throw new NightlifeError("INVALID_REQUEST", `Table ${tableCode}: days cannot exceed 7 entries.`);
    }

    const normalizedDays = days.map((d) => {
      if (!Number.isInteger(d.day_of_week) || d.day_of_week < 0 || d.day_of_week > 6) {
        throw new NightlifeError("INVALID_REQUEST", `Table ${tableCode}: day_of_week must be 0-6 (Sun-Sat).`);
      }
      return {
        day_of_week: d.day_of_week,
        default_status: d.default_status
          ? normalizeTableStatus(d.default_status, "default_status")
          : "available",
        min_spend: normalizeAmount(d.min_spend, "min_spend"),
        currency: normalizeCurrency(d.currency) || "JPY",
        note: normalizeOptionalText(d.note, "note", 500),
      };
    });

    return { tableCode, days: normalizedDays };
  });

  // Resolve table codes to IDs
  const allCodes = [...new Set(normalizedTables.map((t) => t.tableCode))];
  const { data: tableRows, error: tableError } = await supabase
    .from("vip_venue_tables")
    .select("id,table_code")
    .eq("venue_id", venueId)
    .in("table_code", allCodes);

  if (tableError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load venue table IDs.", {
      cause: tableError.message,
    });
  }

  const tableIdByCode = new Map<string, string>();
  for (const row of (tableRows || []) as Array<{ id: string; table_code: string }>) {
    tableIdByCode.set(String(row.table_code).toUpperCase(), row.id);
  }

  const missingCodes = allCodes.filter((code) => !tableIdByCode.has(code));
  if (missingCodes.length > 0) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      `Unknown table_code for venue: ${missingCodes.join(", ")}.`,
    );
  }

  // Build upsert rows
  const upserts: Array<{
    vip_venue_table_id: string;
    venue_id: string;
    day_of_week: number;
    default_status: string;
    min_spend: number | null;
    currency: string;
    note: string | null;
    updated_at: string;
  }> = [];

  const resultTables: Array<{ table_code: string; days_set: number }> = [];

  for (const t of normalizedTables) {
    const tableId = tableIdByCode.get(t.tableCode)!;
    for (const d of t.days) {
      upserts.push({
        vip_venue_table_id: tableId,
        venue_id: venueId,
        day_of_week: d.day_of_week,
        default_status: d.default_status,
        min_spend: d.min_spend,
        currency: d.currency,
        note: d.note,
        updated_at: new Date().toISOString(),
      });
    }
    resultTables.push({ table_code: t.tableCode, days_set: t.days.length });
  }

  const { error: upsertError } = await supabase
    .from("vip_table_day_defaults")
    .upsert(upserts, { onConflict: "vip_venue_table_id,day_of_week" });

  if (upsertError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to upsert VIP table day defaults.", {
      cause: upsertError.message,
    });
  }

  return {
    venue_id: venue.id,
    venue_name: venue.name,
    updated_count: upserts.length,
    tables: resultTables,
  };
}

export async function uploadVipTableChartImage(
  supabase: SupabaseClient,
  input: UploadVipTableChartImageInput,
): Promise<VipTableChartImageUploadResult> {
  const venueId = ensureUuid(input.venue_id, "venue_id");
  const mimeType = normalizeMimeType(input.mime_type);
  const bytes = normalizeImageBase64(input.image_base64);
  const venue = await resolveVenue(supabase, venueId, false);

  const fileExtension = VIP_TABLE_CHART_MIME_EXT[mimeType];
  const fileStem = normalizeFileStem(input.filename);
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const objectPath = `${venueId}/${timestamp}-${fileStem}.${fileExtension}`;

  const storage = supabase.storage.from(VIP_TABLE_CHARTS_BUCKET);
  const { error: uploadError } = await storage.upload(objectPath, bytes, {
    contentType: mimeType,
    upsert: true,
    cacheControl: "3600",
  });
  if (uploadError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to upload VIP table chart image.", {
      cause: uploadError.message,
    });
  }

  const { data: publicUrlData } = storage.getPublicUrl(objectPath);
  const layoutImageUrl = String(publicUrlData?.publicUrl || "").trim();
  if (!layoutImageUrl) {
    throw new NightlifeError(
      "DB_QUERY_FAILED",
      "Failed to resolve uploaded chart image public URL.",
    );
  }

  await applyLayoutImageUrlToVenueTables(supabase, venueId, layoutImageUrl);

  return {
    venue_id: venue.id,
    venue_name: venue.name,
    storage_bucket: VIP_TABLE_CHARTS_BUCKET,
    storage_path: objectPath,
    layout_image_url: layoutImageUrl,
    mime_type: mimeType,
    size_bytes: bytes.length,
    uploaded_at: new Date().toISOString(),
  };
}
