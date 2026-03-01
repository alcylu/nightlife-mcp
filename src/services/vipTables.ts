import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type VipTableAvailabilityMutationResult,
  type VipTableAvailabilityResult,
  type VipTableChartResult,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const TABLE_CODE_RE = /^[A-Z0-9._-]{1,64}$/;
const HTTP_URL_RE = /^https?:\/\/\S+$/i;

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
  vip_booking_enabled: boolean | null;
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

async function resolveVenue(
  supabase: SupabaseClient,
  venueId: string,
  requireVipEnabled: boolean,
): Promise<VipVenueRow> {
  const { data, error } = await supabase
    .from("venues")
    .select("id,name,vip_booking_enabled")
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

  const days = dates.map((bookingDate) => {
    const tableStatuses = candidateTables.map((table) => {
      const row = availabilityByKey.get(`${bookingDate}:${table.id}`);
      const defaultTableNote = extractDefaultTableNote(table.metadata);
      const fallbackStatus = isVipTableStatus(table.default_status)
        ? table.default_status
        : "unknown";
      const status =
        row && isVipTableStatus(String(row.status))
          ? (row.status as VipTableStatus)
          : fallbackStatus;

      return {
        table_id: table.id,
        table_code: table.table_code,
        table_name: table.table_name,
        zone: table.zone,
        capacity_min: table.capacity_min,
        capacity_max: table.capacity_max,
        status,
        min_spend: numberOrNull(row?.min_spend ?? null),
        currency: row?.currency || null,
        note: row?.note || defaultTableNote,
      };
    });

    const availableCount = tableStatuses.filter((table) => table.status === "available").length;
    const visibleTables = includeNonAvailable
      ? tableStatuses
      : tableStatuses.filter((table) => table.status === "available");

    return {
      booking_date: bookingDate,
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

  const chartTables = tables.map((table) => {
    const row = bookingDate ? availabilityByTableId.get(table.id) : null;
    const defaultTableNote = extractDefaultTableNote(table.metadata);
    const fallbackStatus = isVipTableStatus(table.default_status)
      ? table.default_status
      : "unknown";
    const status = bookingDate
      ? row && isVipTableStatus(String(row.status))
        ? (row.status as VipTableStatus)
        : fallbackStatus
      : null;

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
      min_spend: numberOrNull(row?.min_spend ?? null),
      currency: row?.currency || null,
      note: row?.note || defaultTableNote,
    };
  });

  return {
    venue_id: venue.id,
    venue_name: venue.name,
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
