import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDaysToIsoDate,
  getCurrentServiceDate,
  normalizeCutoffTime,
} from "../utils/time.js";
import {
  type VipAcknowledgeClaimResult,
  type VipAgentTaskStatus,
  type VipAgentTaskClaim,
  type VipAlertListResult,
  type VipAlertMarkResult,
  type VipAlertTask,
  type VipBookingCreateResult,
  type VipBookingStatus,
  type VipBookingStatusResult,
  type VipBookingTransitionResult,
  type VipReservationListResult,
} from "../types.js";
import { NightlifeError } from "../errors.js";

export type CreateVipBookingRequestInput = {
  venue_id: string;
  booking_date: string;
  arrival_time: string;
  party_size: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  preferred_table_code?: string;
  special_requests?: string;
};

export type GetVipBookingStatusInput = {
  booking_request_id: string;
  customer_email?: string;
  customer_phone?: string;
};

export type UpdateVipBookingStatusInput = {
  booking_request_id: string;
  to_status: VipBookingStatus;
  actor_type: "agent" | "ops" | "system";
  note?: string;
  status_message?: string;
  agent_internal_note?: string;
};

export type SettleVipAgentTaskInput = {
  task_id: string;
  success: boolean;
  error_message?: string;
};

export type ListVipRequestsForAlertingInput = {
  limit?: number;
  now_iso?: string;
};

export type ListVipReservationsInput = {
  limit?: number;
  statuses?: VipBookingStatus[];
  venue_id?: string;
  booking_date_from?: string;
  booking_date_to?: string;
};

export type MarkVipRequestAlertSentInput = {
  task_id: string;
  broadcast_count: number;
  escalation: boolean;
};

export type ClaimVipRequestAfterAckInput = {
  task_id: string;
  agent_id: string;
  claimed_by_session: string;
  claimed_by_channel: string;
  claimed_by_actor: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TABLE_CODE_RE = /^[A-Z0-9._-]{1,64}$/;
const VIP_STATUSES: VipBookingStatus[] = [
  "submitted",
  "in_review",
  "confirmed",
  "rejected",
  "cancelled",
];
const VIP_ALERT_ELIGIBLE_STATUSES: VipBookingStatus[] = ["submitted", "in_review"];
const VIP_TERMINAL_STATUSES: VipBookingStatus[] = ["confirmed", "rejected", "cancelled"];
const VIP_AGENT_TASK_STATUSES: VipAgentTaskStatus[] = [
  "pending",
  "claimed",
  "done",
  "failed",
];
const DEFAULT_OUTSTANDING_VIP_STATUSES: VipBookingStatus[] = [
  "submitted",
  "in_review",
  "confirmed",
];

const DEFAULT_STATUS_MESSAGE =
  "Your VIP booking request has been sent to the venue booking desk.";
const IN_REVIEW_STATUS_MESSAGE =
  "Your VIP request is now in review with the venue booking team.";

type VenueLookupRow = {
  id: string;
  city_id: string | null;
  vip_booking_enabled: boolean | null;
};

type CityLookupRow = {
  timezone: string | null;
  service_day_cutoff_time: string | null;
};

type VipBookingInsertRow = {
  id: string;
  status: VipBookingStatus;
  created_at: string;
  status_message: string;
};

type VipBookingLookupRow = {
  id: string;
  status: VipBookingStatus;
  updated_at: string;
  status_message: string;
  customer_email: string;
  customer_phone: string;
};

type VipStatusEventRow = {
  to_status: VipBookingStatus;
  note: string | null;
  created_at: string;
};

type VipTaskLookupRow = {
  id: string;
  attempt_count: number;
};

type ClaimVipAgentTaskRow = {
  task_id: string;
  booking_request_id: string;
  attempt_count: number;
  booking_date: string;
  arrival_time: string;
  party_size: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  special_requests: string | null;
  current_status: VipBookingStatus;
};

type ListDueVipAlertTaskRow = {
  task_id: string;
  booking_request_id: string;
  booking_date: string;
  arrival_time: string;
  party_size: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  special_requests: string | null;
  venue_id: string;
  venue_name: string | null;
  current_status: string;
  request_created_at: string;
  first_alerted_at: string | null;
  last_alerted_at: string | null;
  alert_count: number;
  escalated_at: string | null;
  should_escalate: boolean;
};

type MarkVipAlertSentRow = {
  task_id: string;
  status: string;
  first_alerted_at: string | null;
  last_alerted_at: string | null;
  alert_count: number;
  escalated_at: string | null;
  next_attempt_at: string;
};

type AcknowledgeVipTaskRow = {
  task_id: string;
  task_status: string;
  booking_request_id: string;
  booking_status: string;
  booking_status_message: string;
  booking_updated_at: string;
  acknowledged_by: string | null;
  acknowledged_channel: string | null;
  acknowledged_session: string | null;
  acknowledged_at: string | null;
};

type VipReservationRow = {
  id: string;
  status: string;
  status_message: string;
  booking_date: string;
  arrival_time: string;
  party_size: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  special_requests: string | null;
  venue_id: string;
  created_at: string;
  updated_at: string;
};

type VipVenueNameRow = {
  id: string;
  name: string | null;
};

type VipReservationEventRow = {
  booking_request_id: string;
  actor_type: string;
  note: string | null;
  created_at: string;
};

type VipReservationTaskRow = {
  id: string;
  booking_request_id: string;
  status: string;
  attempt_count: number;
  next_attempt_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  alert_count: number | null;
  last_alerted_at: string | null;
  updated_at: string;
};

function ensureUuid(input: string, label: string): string {
  const normalized = String(input || "").trim();
  if (!UUID_RE.test(normalized)) {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      `${label} must be a valid UUID.`,
    );
  }
  return normalized;
}

function normalizeBookingDate(input: string): string {
  const normalized = String(input || "").trim();
  if (!ISO_DATE_RE.test(normalized)) {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      "booking_date must use YYYY-MM-DD format.",
    );
  }

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      "booking_date must be a valid calendar date.",
    );
  }

  return normalized;
}

function normalizeArrivalTime(input: string): string {
  const normalized = String(input || "").trim();
  if (!TIME_RE.test(normalized)) {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      "arrival_time must use HH:MM 24-hour format.",
    );
  }
  return normalized;
}

function normalizePartySize(input: number): number {
  if (!Number.isInteger(input) || input < 1 || input > 30) {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      "party_size must be an integer between 1 and 30.",
    );
  }
  return input;
}

function normalizeCustomerName(input: string): string {
  const normalized = String(input || "").trim();
  if (!normalized) {
    throw new NightlifeError("INVALID_BOOKING_REQUEST", "customer_name cannot be blank.");
  }
  return normalized.slice(0, 120);
}

function normalizeCustomerEmail(input: string): string {
  const normalized = String(input || "").trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      "customer_email must be a valid email address.",
    );
  }
  return normalized.slice(0, 254);
}

function normalizeCustomerPhone(input: string): string {
  const normalized = String(input || "").trim();
  if (!normalized) {
    throw new NightlifeError("INVALID_BOOKING_REQUEST", "customer_phone cannot be blank.");
  }

  const cleaned = normalized.replace(/[^\d+]/g, "");
  const plusCount = (cleaned.match(/\+/g) || []).length;
  const digitsOnly = cleaned.replace(/\D/g, "");

  if (plusCount > 1 || (plusCount === 1 && !cleaned.startsWith("+"))) {
    throw new NightlifeError("INVALID_BOOKING_REQUEST", "customer_phone format is invalid.");
  }

  if (digitsOnly.length < 7 || digitsOnly.length > 20) {
    throw new NightlifeError("INVALID_BOOKING_REQUEST", "customer_phone format is invalid.");
  }

  return cleaned.slice(0, 32);
}

function normalizeOptionalText(input: string | undefined, maxLength: number): string | null {
  const normalized = String(input || "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function normalizeOptionalTableCode(input: string | undefined): string | null {
  const normalized = String(input || "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (!TABLE_CODE_RE.test(normalized)) {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      "preferred_table_code must contain only letters, numbers, dots, hyphens, or underscores (max 64 chars).",
    );
  }
  return normalized;
}

type TablePricingLookup = {
  found: boolean;
  tableId: string | null;
  minSpend: number | null;
  currency: string | null;
};

async function lookupTablePricing(
  supabase: SupabaseClient,
  venueId: string,
  tableCode: string,
  bookingDate: string,
): Promise<TablePricingLookup> {
  const { data: table, error: tableError } = await supabase
    .from("vip_venue_tables")
    .select("id")
    .eq("venue_id", venueId)
    .eq("table_code", tableCode)
    .maybeSingle<{ id: string }>();

  if (tableError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to validate table code.", {
      cause: tableError.message,
    });
  }

  if (!table) {
    return { found: false, tableId: null, minSpend: null, currency: null };
  }

  // Level 1: Check explicit per-date availability
  const { data: explicit } = await supabase
    .from("vip_table_availability")
    .select("min_spend,currency")
    .eq("vip_venue_table_id", table.id)
    .eq("booking_date", bookingDate)
    .maybeSingle<{ min_spend: number | null; currency: string | null }>();

  if (explicit?.min_spend != null) {
    return { found: true, tableId: table.id, minSpend: explicit.min_spend, currency: explicit.currency };
  }

  // Level 2: Check day-of-week defaults
  const dayOfWeek = new Date(`${bookingDate}T00:00:00Z`).getUTCDay();
  const { data: dayDefault } = await supabase
    .from("vip_table_day_defaults")
    .select("min_spend,currency")
    .eq("vip_venue_table_id", table.id)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle<{ min_spend: number | null; currency: string | null }>();

  if (dayDefault?.min_spend != null) {
    return { found: true, tableId: table.id, minSpend: dayDefault.min_spend, currency: dayDefault.currency };
  }

  // Level 3: Venue-level default
  const { data: venue } = await supabase
    .from("venues")
    .select("vip_default_min_spend,vip_default_currency")
    .eq("id", venueId)
    .maybeSingle<{ vip_default_min_spend: number | null; vip_default_currency: string | null }>();

  if (venue?.vip_default_min_spend != null) {
    return { found: true, tableId: table.id, minSpend: venue.vip_default_min_spend, currency: venue.vip_default_currency };
  }

  // Level 4: No pricing data
  return { found: true, tableId: table.id, minSpend: null, currency: null };
}

function normalizeStatusMessage(input: string | undefined): string | null {
  const normalized = normalizeOptionalText(input, 400);
  return normalized;
}

function normalizeInternalNote(input: string | undefined): string | null {
  const normalized = normalizeOptionalText(input, 2000);
  return normalized;
}

function normalizeHistoryNote(input: string | undefined): string | null {
  const normalized = normalizeOptionalText(input, 400);
  return normalized;
}

function normalizeAlertLimit(input: number | undefined): number {
  if (input === undefined) {
    return 20;
  }

  if (!Number.isInteger(input) || input < 1 || input > 50) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "limit must be an integer between 1 and 50.",
    );
  }

  return input;
}

function normalizeReservationListLimit(input: number | undefined): number {
  if (input === undefined) {
    return 20;
  }

  if (!Number.isInteger(input) || input < 1 || input > 100) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "limit must be an integer between 1 and 100.",
    );
  }

  return input;
}

function normalizeNowIso(input: string | undefined): string {
  if (input === undefined) {
    return new Date().toISOString();
  }

  const normalized = String(input || "").trim();
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime())) {
    throw new NightlifeError("INVALID_REQUEST", "now_iso must be a valid ISO timestamp.");
  }

  return parsed.toISOString();
}

function normalizeOptionalFilterDate(input: string | undefined, field: string): string | null {
  const normalized = String(input || "").trim();
  if (!normalized) {
    return null;
  }
  if (!ISO_DATE_RE.test(normalized)) {
    throw new NightlifeError("INVALID_REQUEST", `${field} must use YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new NightlifeError("INVALID_REQUEST", `${field} must be a valid calendar date.`);
  }

  return normalized;
}

function normalizeReservationStatuses(input: VipBookingStatus[] | undefined): VipBookingStatus[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...DEFAULT_OUTSTANDING_VIP_STATUSES];
  }

  const deduped: VipBookingStatus[] = [];
  for (const rawValue of input) {
    const normalized = String(rawValue || "").trim();
    if (!isVipStatus(normalized)) {
      throw new NightlifeError(
        "INVALID_REQUEST",
        "statuses contains an invalid VIP booking status.",
      );
    }
    if (!deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  }

  if (deduped.length === 0) {
    return [...DEFAULT_OUTSTANDING_VIP_STATUSES];
  }

  return deduped;
}

function normalizeActorField(input: string, field: string, maxLength: number): string {
  const normalized = String(input || "").trim();
  if (!normalized) {
    throw new NightlifeError("INVALID_REQUEST", `${field} cannot be blank.`);
  }
  return normalized.slice(0, maxLength);
}

function isVipStatus(value: string): value is VipBookingStatus {
  return VIP_STATUSES.includes(value as VipBookingStatus);
}

function isVipAlertEligibleStatus(value: string): value is VipBookingStatus {
  return VIP_ALERT_ELIGIBLE_STATUSES.includes(value as VipBookingStatus);
}

function isVipTerminalStatus(value: VipBookingStatus): boolean {
  return VIP_TERMINAL_STATUSES.includes(value);
}

function isVipAgentTaskStatus(value: string): value is VipAgentTaskStatus {
  return VIP_AGENT_TASK_STATUSES.includes(value as VipAgentTaskStatus);
}

function isVipEventActorType(
  value: string,
): value is "customer" | "agent" | "ops" | "system" {
  return ["customer", "agent", "ops", "system"].includes(value);
}

export function isAllowedVipStatusTransition(
  fromStatus: VipBookingStatus,
  toStatus: VipBookingStatus,
): boolean {
  if (fromStatus === "submitted") {
    return ["in_review", "confirmed", "rejected", "cancelled"].includes(toStatus);
  }

  if (fromStatus === "in_review") {
    return ["confirmed", "rejected", "cancelled"].includes(toStatus);
  }

  if (fromStatus === "confirmed") {
    return toStatus === "cancelled";
  }

  return false;
}

async function resolveBookingWindow(
  supabase: SupabaseClient,
  venueId: string,
): Promise<{ currentServiceDate: string; maxServiceDate: string }> {
  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .select("id,city_id,vip_booking_enabled")
    .eq("id", venueId)
    .maybeSingle<VenueLookupRow>();

  if (venueError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load venue details.", {
      cause: venueError.message,
    });
  }

  if (!venue) {
    throw new NightlifeError("INVALID_BOOKING_REQUEST", "Unknown venue_id.");
  }

  if (venue.vip_booking_enabled !== true) {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      "VIP booking is not currently available for this venue. Use search_venues with vip_booking_supported_only=true.",
    );
  }

  let timeZone = "UTC";
  let cutoffTime = "06:00";

  if (venue.city_id) {
    const { data: city, error: cityError } = await supabase
      .from("cities")
      .select("timezone,service_day_cutoff_time")
      .eq("id", venue.city_id)
      .maybeSingle<CityLookupRow>();

    if (cityError) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to load city timezone context.", {
        cause: cityError.message,
      });
    }

    if (city?.timezone) {
      timeZone = city.timezone;
    }
    cutoffTime = normalizeCutoffTime(city?.service_day_cutoff_time || cutoffTime);
  }

  const currentServiceDate = getCurrentServiceDate(new Date(), timeZone, cutoffTime);
  return {
    currentServiceDate,
    maxServiceDate: addDaysToIsoDate(currentServiceDate, 30),
  };
}

function normalizeStatusLookupContacts(input: GetVipBookingStatusInput): {
  bookingRequestId: string;
  customerEmail: string | null;
  customerPhone: string | null;
} {
  const bookingRequestId = ensureUuid(input.booking_request_id, "booking_request_id");

  const emailRaw = String(input.customer_email || "").trim();
  const phoneRaw = String(input.customer_phone || "").trim();
  if (!emailRaw && !phoneRaw) {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      "Either customer_email or customer_phone is required.",
    );
  }

  return {
    bookingRequestId,
    customerEmail: emailRaw ? normalizeCustomerEmail(emailRaw) : null,
    customerPhone: phoneRaw ? normalizeCustomerPhone(phoneRaw) : null,
  };
}

export async function createVipBookingRequest(
  supabase: SupabaseClient,
  input: CreateVipBookingRequestInput,
): Promise<VipBookingCreateResult> {
  const venueId = ensureUuid(input.venue_id, "venue_id");
  const bookingDate = normalizeBookingDate(input.booking_date);
  const arrivalTime = normalizeArrivalTime(input.arrival_time);
  const partySize = normalizePartySize(input.party_size);
  const customerName = normalizeCustomerName(input.customer_name);
  const customerEmail = normalizeCustomerEmail(input.customer_email);
  const customerPhone = normalizeCustomerPhone(input.customer_phone);
  const preferredTableCode = normalizeOptionalTableCode(input.preferred_table_code);
  const specialRequests = normalizeOptionalText(input.special_requests, 2000);

  const window = await resolveBookingWindow(supabase, venueId);
  if (bookingDate < window.currentServiceDate || bookingDate > window.maxServiceDate) {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      `booking_date must be between ${window.currentServiceDate} and ${window.maxServiceDate}.`,
    );
  }

  let minSpend: number | null = null;
  let minSpendCurrency: string | null = null;
  let tableWarning: string | null = null;

  if (preferredTableCode) {
    const pricing = await lookupTablePricing(supabase, venueId, preferredTableCode, bookingDate);
    if (!pricing.found) {
      tableWarning = `Table "${preferredTableCode}" was not found in our system for this venue. The booking request has been submitted and the venue will confirm table availability.`;
    }
    minSpend = pricing.minSpend;
    minSpendCurrency = pricing.currency;
  }

  const { data: created, error: createError } = await supabase
    .from("vip_booking_requests")
    .insert({
      venue_id: venueId,
      booking_date: bookingDate,
      arrival_time: arrivalTime,
      party_size: partySize,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      preferred_table_code: preferredTableCode,
      min_spend: minSpend,
      min_spend_currency: minSpendCurrency,
      special_requests: specialRequests,
      status: "submitted",
      status_message: DEFAULT_STATUS_MESSAGE,
    })
    .select("id,status,created_at,status_message")
    .single<VipBookingInsertRow>();

  if (createError || !created) {
    throw new NightlifeError("REQUEST_WRITE_FAILED", "Failed to create VIP booking request.", {
      cause: createError?.message || "Unknown insert error",
    });
  }

  const { error: eventError } = await supabase
    .from("vip_booking_status_events")
    .insert({
      booking_request_id: created.id,
      from_status: null,
      to_status: "submitted",
      actor_type: "customer",
      note: "VIP booking request sent to venue booking desk.",
    });

  const { error: taskError } = await supabase
    .from("vip_agent_tasks")
    .insert({
      booking_request_id: created.id,
      task_type: "new_vip_request",
      status: "pending",
      attempt_count: 0,
      next_attempt_at: new Date().toISOString(),
    });

  if (eventError || taskError) {
    throw new NightlifeError(
      "REQUEST_WRITE_FAILED",
      "Failed to submit VIP booking request.",
      {
        cause: {
          status_event_error: eventError?.message || null,
          task_error: taskError?.message || null,
        },
      },
    );
  }

  return {
    booking_request_id: created.id,
    status: created.status,
    created_at: created.created_at,
    message: created.status_message,
    preferred_table_code: preferredTableCode,
    min_spend: minSpend,
    min_spend_currency: minSpendCurrency,
    table_warning: tableWarning,
  };
}

export async function getVipBookingStatus(
  supabase: SupabaseClient,
  input: GetVipBookingStatusInput,
): Promise<VipBookingStatusResult> {
  const { bookingRequestId, customerEmail, customerPhone } = normalizeStatusLookupContacts(input);

  const { data: booking, error: bookingError } = await supabase
    .from("vip_booking_requests")
    .select("id,status,updated_at,status_message,customer_email,customer_phone")
    .eq("id", bookingRequestId)
    .maybeSingle<VipBookingLookupRow>();

  if (bookingError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch VIP booking request.", {
      cause: bookingError.message,
    });
  }

  if (!booking) {
    throw new NightlifeError("BOOKING_REQUEST_NOT_FOUND", "VIP booking request not found.");
  }

  const emailMatches = !!customerEmail && booking.customer_email === customerEmail;
  const phoneMatches = !!customerPhone && booking.customer_phone === customerPhone;
  if (!emailMatches && !phoneMatches) {
    throw new NightlifeError("BOOKING_REQUEST_NOT_FOUND", "VIP booking request not found.");
  }

  const { data: events, error: eventsError } = await supabase
    .from("vip_booking_status_events")
    .select("to_status,note,created_at")
    .eq("booking_request_id", booking.id)
    .order("created_at", { ascending: true })
    .limit(20);

  if (eventsError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch VIP booking history.", {
      cause: eventsError.message,
    });
  }

  const history = ((events || []) as VipStatusEventRow[])
    .filter((row) => isVipStatus(row.to_status))
    .map((row) => ({
      status: row.to_status,
      at: row.created_at,
      note: row.note,
    }));

  const latestHistory = history[history.length - 1];

  return {
    booking_request_id: booking.id,
    status: booking.status,
    last_updated_at: booking.updated_at,
    status_message: booking.status_message,
    latest_note: latestHistory?.note || null,
    history,
  };
}

export async function claimNextVipAgentTask(
  supabase: SupabaseClient,
  agentId: string,
): Promise<VipAgentTaskClaim | null> {
  const normalizedAgentId = String(agentId || "").trim();
  if (!normalizedAgentId) {
    throw new NightlifeError("INVALID_REQUEST", "agent_id cannot be blank.");
  }

  const { data, error } = await supabase.rpc("claim_next_vip_agent_task", {
    p_agent_id: normalizedAgentId.slice(0, 128),
  });

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to claim VIP agent task.", {
      cause: error.message,
    });
  }

  const row = Array.isArray(data) ? (data[0] as ClaimVipAgentTaskRow | undefined) : undefined;
  if (!row) {
    return null;
  }

  return {
    task_id: row.task_id,
    booking_request_id: row.booking_request_id,
    attempt_count: row.attempt_count,
    booking_date: row.booking_date,
    arrival_time: row.arrival_time,
    party_size: row.party_size,
    customer_name: row.customer_name,
    customer_email: row.customer_email,
    customer_phone: row.customer_phone,
    special_requests: row.special_requests,
    current_status: row.current_status,
  };
}

export async function listVipRequestsForAlerting(
  supabase: SupabaseClient,
  input: ListVipRequestsForAlertingInput,
): Promise<VipAlertListResult> {
  const limit = normalizeAlertLimit(input.limit);
  const nowIso = normalizeNowIso(input.now_iso);

  const { data, error } = await supabase.rpc("list_due_vip_alert_tasks", {
    p_limit: limit,
    p_now: nowIso,
  });

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to list VIP alert tasks.", {
      cause: error.message,
    });
  }

  const rows = Array.isArray(data) ? (data as ListDueVipAlertTaskRow[]) : [];
  const tasks: VipAlertTask[] = rows
    .filter((row) => isVipAlertEligibleStatus(String(row.current_status)))
    .map((row) => ({
      task_id: row.task_id,
      booking_request_id: row.booking_request_id,
      booking_date: row.booking_date,
      arrival_time: row.arrival_time,
      party_size: row.party_size,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      customer_phone: row.customer_phone,
      special_requests: row.special_requests,
      venue_id: row.venue_id,
      venue_name: row.venue_name,
      current_status: row.current_status as VipBookingStatus,
      request_created_at: row.request_created_at,
      first_alerted_at: row.first_alerted_at,
      last_alerted_at: row.last_alerted_at,
      alert_count: row.alert_count,
      escalated_at: row.escalated_at,
      should_escalate: Boolean(row.should_escalate),
    }));

  return {
    now: nowIso,
    tasks,
  };
}

export async function listVipReservations(
  supabase: SupabaseClient,
  input: ListVipReservationsInput,
): Promise<VipReservationListResult> {
  const limit = normalizeReservationListLimit(input.limit);
  const statuses = normalizeReservationStatuses(input.statuses);
  const venueId = String(input.venue_id || "").trim()
    ? ensureUuid(input.venue_id || "", "venue_id")
    : null;
  const bookingDateFrom = normalizeOptionalFilterDate(
    input.booking_date_from,
    "booking_date_from",
  );
  const bookingDateTo = normalizeOptionalFilterDate(input.booking_date_to, "booking_date_to");
  const nowIso = new Date().toISOString();

  if (bookingDateFrom && bookingDateTo && bookingDateFrom > bookingDateTo) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "booking_date_from cannot be after booking_date_to.",
    );
  }

  let requestQuery = supabase
    .from("vip_booking_requests")
    .select(
      "id,status,status_message,booking_date,arrival_time,party_size,customer_name,customer_email,customer_phone,special_requests,venue_id,created_at,updated_at",
    )
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (venueId) {
    requestQuery = requestQuery.eq("venue_id", venueId);
  }
  if (bookingDateFrom) {
    requestQuery = requestQuery.gte("booking_date", bookingDateFrom);
  }
  if (bookingDateTo) {
    requestQuery = requestQuery.lte("booking_date", bookingDateTo);
  }

  const { data: requestRows, error: requestError } = await requestQuery;
  if (requestError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to list VIP booking requests.", {
      cause: requestError.message,
    });
  }

  const reservations = Array.isArray(requestRows)
    ? (requestRows as VipReservationRow[])
    : [];

  if (reservations.length === 0) {
    return {
      now: nowIso,
      count: 0,
      statuses,
      reservations: [],
    };
  }

  const bookingRequestIds = reservations.map((row) => row.id);
  const venueIds = [...new Set(reservations.map((row) => row.venue_id))];

  const { data: venueRows, error: venueError } = await supabase
    .from("venues")
    .select("id,name")
    .in("id", venueIds);
  if (venueError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP reservation venue names.", {
      cause: venueError.message,
    });
  }
  const venueNameById = new Map<string, string | null>(
    ((venueRows || []) as VipVenueNameRow[]).map((row) => [row.id, row.name || null]),
  );

  const { data: eventRows, error: eventError } = await supabase
    .from("vip_booking_status_events")
    .select("booking_request_id,actor_type,note,created_at")
    .in("booking_request_id", bookingRequestIds)
    .order("created_at", { ascending: false });
  if (eventError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP reservation history.", {
      cause: eventError.message,
    });
  }
  const latestEventByBooking = new Map<string, VipReservationEventRow>();
  for (const row of (eventRows || []) as VipReservationEventRow[]) {
    if (!latestEventByBooking.has(row.booking_request_id)) {
      latestEventByBooking.set(row.booking_request_id, row);
    }
  }

  const { data: taskRows, error: taskError } = await supabase
    .from("vip_agent_tasks")
    .select(
      "id,booking_request_id,status,attempt_count,next_attempt_at,claimed_by,claimed_at,alert_count,last_alerted_at,updated_at",
    )
    .in("booking_request_id", bookingRequestIds)
    .order("created_at", { ascending: false });
  if (taskError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP reservation task state.", {
      cause: taskError.message,
    });
  }
  const latestTaskByBooking = new Map<string, VipReservationTaskRow>();
  for (const row of (taskRows || []) as VipReservationTaskRow[]) {
    if (!latestTaskByBooking.has(row.booking_request_id)) {
      latestTaskByBooking.set(row.booking_request_id, row);
    }
  }

  const summaries = reservations
    .filter(
      (row): row is VipReservationRow & { status: VipBookingStatus } =>
        isVipStatus(row.status),
    )
    .map((row) => {
      const latestEvent = latestEventByBooking.get(row.id);
      const latestTask = latestTaskByBooking.get(row.id);
      const latestTaskStatus =
        latestTask && isVipAgentTaskStatus(String(latestTask.status))
          ? (latestTask.status as VipAgentTaskStatus)
          : null;
      const latestEventActorType =
        latestEvent && isVipEventActorType(latestEvent.actor_type)
          ? latestEvent.actor_type
          : null;

      return {
        booking_request_id: row.id,
        status: row.status,
        status_message: row.status_message,
        booking_date: row.booking_date,
        arrival_time: row.arrival_time,
        party_size: row.party_size,
        customer_name: row.customer_name,
        customer_email: row.customer_email,
        customer_phone: row.customer_phone,
        special_requests: row.special_requests,
        venue_id: row.venue_id,
        venue_name: venueNameById.get(row.venue_id) || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        latest_event_note: latestEvent?.note || null,
        latest_event_at: latestEvent?.created_at || null,
        latest_event_actor_type: latestEventActorType,
        latest_task:
          latestTask && latestTaskStatus
            ? {
              task_id: latestTask.id,
              status: latestTaskStatus,
              attempt_count: latestTask.attempt_count,
              next_attempt_at: latestTask.next_attempt_at,
              claimed_by: latestTask.claimed_by,
              claimed_at: latestTask.claimed_at,
              alert_count: latestTask.alert_count,
              last_alerted_at: latestTask.last_alerted_at,
              updated_at: latestTask.updated_at,
            }
            : null,
      };
    });

  return {
    now: nowIso,
    count: summaries.length,
    statuses,
    reservations: summaries,
  };
}

export async function markVipRequestAlertSent(
  supabase: SupabaseClient,
  input: MarkVipRequestAlertSentInput,
): Promise<VipAlertMarkResult> {
  const taskId = ensureUuid(input.task_id, "task_id");
  if (!Number.isInteger(input.broadcast_count) || input.broadcast_count < 0) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "broadcast_count must be an integer greater than or equal to 0.",
    );
  }

  const { data, error } = await supabase.rpc("mark_vip_request_alert_sent", {
    p_task_id: taskId,
    p_broadcast_count: input.broadcast_count,
    p_escalation: Boolean(input.escalation),
  });

  if (error) {
    throw new NightlifeError(
      "VIP_ALERT_UPDATE_FAILED",
      "Failed to update VIP alert delivery state.",
      {
        cause: error.message,
      },
    );
  }

  const row = Array.isArray(data) ? (data[0] as MarkVipAlertSentRow | undefined) : undefined;
  if (!row) {
    throw new NightlifeError("VIP_TASK_NOT_AVAILABLE", "VIP alert task is not available.");
  }

  if (row.status !== "pending") {
    throw new NightlifeError("VIP_ALERT_UPDATE_FAILED", "VIP alert task entered an invalid state.");
  }

  return {
    task_id: row.task_id,
    status: "pending",
    first_alerted_at: row.first_alerted_at,
    last_alerted_at: row.last_alerted_at,
    alert_count: row.alert_count,
    escalated_at: row.escalated_at,
    next_attempt_at: row.next_attempt_at,
  };
}

export async function claimVipRequestAfterAck(
  supabase: SupabaseClient,
  input: ClaimVipRequestAfterAckInput,
): Promise<VipAcknowledgeClaimResult> {
  const taskId = ensureUuid(input.task_id, "task_id");
  const agentId = normalizeActorField(input.agent_id, "agent_id", 128);
  const claimedBySession = normalizeActorField(
    input.claimed_by_session,
    "claimed_by_session",
    255,
  );
  const claimedByChannel = normalizeActorField(
    input.claimed_by_channel,
    "claimed_by_channel",
    64,
  );
  const claimedByActor = normalizeActorField(input.claimed_by_actor, "claimed_by_actor", 128);

  const { data, error } = await supabase.rpc("acknowledge_vip_agent_task", {
    p_task_id: taskId,
    p_agent_id: agentId,
    p_claimed_by_session: claimedBySession,
    p_claimed_by_channel: claimedByChannel,
    p_claimed_by_actor: claimedByActor,
  });

  if (error) {
    const message = String(error.message || "");
    if (message.toLowerCase().includes("not available for acknowledgement")) {
      throw new NightlifeError(
        "VIP_TASK_NOT_AVAILABLE",
        "VIP alert task was already claimed.",
      );
    }

    throw new NightlifeError("VIP_CLAIM_FAILED", "Failed to claim VIP task after acknowledgement.", {
      cause: message,
    });
  }

  const row = Array.isArray(data) ? (data[0] as AcknowledgeVipTaskRow | undefined) : undefined;
  if (!row) {
    throw new NightlifeError("VIP_TASK_NOT_AVAILABLE", "VIP alert task was already claimed.");
  }

  if (!isVipStatus(String(row.booking_status))) {
    throw new NightlifeError("VIP_CLAIM_FAILED", "VIP booking status payload is invalid.");
  }

  if (row.task_status !== "done") {
    throw new NightlifeError("VIP_CLAIM_FAILED", "VIP task claim did not complete.");
  }

  return {
    task_id: row.task_id,
    task_status: "done",
    booking_request_id: row.booking_request_id,
    booking_status: row.booking_status as VipBookingStatus,
    booking_status_message: row.booking_status_message || IN_REVIEW_STATUS_MESSAGE,
    booking_updated_at: row.booking_updated_at,
    acknowledged_by: row.acknowledged_by,
    acknowledged_channel: row.acknowledged_channel,
    acknowledged_session: row.acknowledged_session,
    acknowledged_at: row.acknowledged_at,
  };
}

export async function updateVipBookingStatus(
  supabase: SupabaseClient,
  input: UpdateVipBookingStatusInput,
): Promise<VipBookingTransitionResult> {
  const bookingRequestId = ensureUuid(input.booking_request_id, "booking_request_id");
  const toStatus = input.to_status;
  const actorType = input.actor_type;
  const note = normalizeHistoryNote(input.note);
  const statusMessage = normalizeStatusMessage(input.status_message);
  const agentInternalNote = normalizeInternalNote(input.agent_internal_note);

  if (!isVipStatus(toStatus)) {
    throw new NightlifeError("INVALID_BOOKING_REQUEST", "to_status is invalid.");
  }

  const { data: current, error: currentError } = await supabase
    .from("vip_booking_requests")
    .select("id,status")
    .eq("id", bookingRequestId)
    .maybeSingle<{ id: string; status: VipBookingStatus }>();

  if (currentError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load current booking status.", {
      cause: currentError.message,
    });
  }

  if (!current) {
    throw new NightlifeError("BOOKING_REQUEST_NOT_FOUND", "VIP booking request not found.");
  }

  if (!isAllowedVipStatusTransition(current.status, toStatus)) {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      `Invalid status transition: ${current.status} -> ${toStatus}.`,
    );
  }

  const patch: Record<string, unknown> = {
    status: toStatus,
  };
  if (statusMessage !== null) {
    patch.status_message = statusMessage;
  }
  if (agentInternalNote !== null) {
    patch.agent_internal_note = agentInternalNote;
  }

  const { data: updated, error: updateError } = await supabase
    .from("vip_booking_requests")
    .update(patch)
    .eq("id", bookingRequestId)
    .select("id,status,updated_at,status_message")
    .single<{ id: string; status: VipBookingStatus; updated_at: string; status_message: string }>();

  if (updateError || !updated) {
    throw new NightlifeError(
      "BOOKING_STATUS_UPDATE_FAILED",
      "Failed to update VIP booking status.",
      {
        cause: updateError?.message || "Unknown update error",
      },
    );
  }

  const { error: eventError } = await supabase
    .from("vip_booking_status_events")
    .insert({
      booking_request_id: bookingRequestId,
      from_status: current.status,
      to_status: toStatus,
      actor_type: actorType,
      note,
    });

  if (eventError) {
    throw new NightlifeError(
      "BOOKING_STATUS_UPDATE_FAILED",
      "VIP booking status changed but event logging failed.",
      {
        cause: eventError.message,
      },
    );
  }

  if (isVipTerminalStatus(toStatus)) {
    const { error: settleError } = await supabase
      .from("vip_agent_tasks")
      .update({
        status: "done",
        last_error: null,
      })
      .eq("booking_request_id", bookingRequestId)
      .in("status", ["pending", "claimed"]);

    if (settleError) {
      throw new NightlifeError(
        "BOOKING_STATUS_UPDATE_FAILED",
        "VIP booking status changed but queue settlement failed.",
        {
          cause: settleError.message,
        },
      );
    }
  }

  return {
    booking_request_id: updated.id,
    status: updated.status,
    last_updated_at: updated.updated_at,
    status_message: updated.status_message,
  };
}

export async function settleVipAgentTask(
  supabase: SupabaseClient,
  input: SettleVipAgentTaskInput,
): Promise<{ task_id: string; status: "done" | "pending" | "failed" }> {
  const taskId = ensureUuid(input.task_id, "task_id");

  if (input.success) {
    const { error: doneError } = await supabase
      .from("vip_agent_tasks")
      .update({
        status: "done",
        last_error: null,
      })
      .eq("id", taskId)
      .eq("status", "claimed");

    if (doneError) {
      throw new NightlifeError("BOOKING_STATUS_UPDATE_FAILED", "Failed to mark VIP task done.", {
        cause: doneError.message,
      });
    }

    return {
      task_id: taskId,
      status: "done",
    };
  }

  const { data: task, error: taskError } = await supabase
    .from("vip_agent_tasks")
    .select("id,attempt_count")
    .eq("id", taskId)
    .maybeSingle<VipTaskLookupRow>();

  if (taskError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP task for retry.", {
      cause: taskError.message,
    });
  }

  if (!task) {
    throw new NightlifeError("BOOKING_REQUEST_NOT_FOUND", "VIP agent task not found.");
  }

  const shouldFail = task.attempt_count >= 5;
  const status = shouldFail ? "failed" : "pending";
  const nextAttemptAt = shouldFail
    ? null
    : new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error: retryError } = await supabase
    .from("vip_agent_tasks")
    .update({
      status,
      next_attempt_at: nextAttemptAt,
      claimed_by: null,
      claimed_at: null,
      last_error: normalizeOptionalText(input.error_message, 1000),
    })
    .eq("id", taskId);

  if (retryError) {
    throw new NightlifeError(
      "BOOKING_STATUS_UPDATE_FAILED",
      "Failed to update VIP agent task retry state.",
      {
        cause: retryError.message,
      },
    );
  }

  return {
    task_id: taskId,
    status,
  };
}
