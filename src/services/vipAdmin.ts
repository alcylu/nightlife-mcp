import type { SupabaseClient } from "@supabase/supabase-js";
import { NightlifeError } from "../errors.js";
import type {
  VipAdminBookingDetailResult,
  VipAdminBookingHistoryEntry,
  VipAdminBookingListResult,
  VipAdminBookingSummary,
  VipAdminBookingUpdateResult,
  VipAgentTaskStatus,
  VipBookingCreateResult,
  VipBookingEditAuditEntry,
  VipBookingStatus,
} from "../types.js";
import {
  createVipBookingRequest,
  type CreateVipBookingRequestInput,
} from "./vipBookings.js";

export type ListVipAdminBookingsInput = {
  statuses?: VipBookingStatus[];
  booking_date_from?: string;
  booking_date_to?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type UpdateVipAdminBookingPatch = {
  status?: VipBookingStatus;
  status_message?: string;
  agent_internal_note?: string | null;
  booking_date?: string;
  arrival_time?: string;
  party_size?: number;
  special_requests?: string | null;
};

export type UpdateVipAdminBookingInput = {
  booking_request_id: string;
  editor_username: string;
  patch: UpdateVipAdminBookingPatch;
  note?: string;
};

export type CreateVipAdminBookingInput = CreateVipBookingRequestInput;

export type VipAdminVenueOption = {
  venue_id: string;
  venue_name: string;
  city_name: string | null;
};

export type VipAdminVenueListResult = {
  now: string;
  count: number;
  venues: VipAdminVenueOption[];
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const VIP_STATUSES: VipBookingStatus[] = [
  "submitted",
  "in_review",
  "deposit_required",
  "confirmed",
  "rejected",
  "cancelled",
];
const VIP_AGENT_TASK_STATUSES: VipAgentTaskStatus[] = [
  "pending",
  "claimed",
  "done",
  "failed",
];

const MAX_ADMIN_LIMIT = 100;
const DEFAULT_ADMIN_LIMIT = 50;
const DEFAULT_STATUSES: VipBookingStatus[] = [...VIP_STATUSES];

type VipBookingRequestRow = {
  id: string;
  status: string;
  status_message: string;
  agent_internal_note: string | null;
  booking_date: string;
  arrival_time: string;
  party_size: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  special_requests: string | null;
  preferred_table_code: string | null;
  min_spend: number | null;
  min_spend_currency: string | null;
  venue_id: string;
  created_at: string;
  updated_at: string;
};

type VipVenueNameRow = {
  id: string;
  name: string | null;
};

type VipVenueOptionRow = {
  id: string;
  name: string | null;
  city: string | null;
  vip_booking_enabled: boolean | null;
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

type VipStatusEventHistoryRow = {
  to_status: string;
  actor_type: string;
  note: string | null;
  created_at: string;
};

type VipEditAuditRow = {
  id: string;
  editor_username: string;
  change_note: string | null;
  changed_fields: string[] | null;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  created_at: string;
};

type AdminUpdateRpcRow = {
  booking_request_id: string;
  changed_fields: string[];
  audit_id: string;
  updated_at: string;
};

function ensureUuid(input: string, label: string): string {
  const normalized = String(input || "").trim();
  if (!UUID_RE.test(normalized)) {
    throw new NightlifeError("INVALID_REQUEST", `${label} must be a valid UUID.`);
  }
  return normalized;
}

function normalizeOptionalDate(value: string | undefined, field: string): string | null {
  const normalized = String(value || "").trim();
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

function normalizeOptionalSearch(value: string | undefined): string | null {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  if (/[(),]/.test(normalized)) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "search cannot include commas or parentheses.",
    );
  }

  return normalized.slice(0, 120);
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_ADMIN_LIMIT;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_ADMIN_LIMIT) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      `limit must be an integer between 1 and ${MAX_ADMIN_LIMIT}.`,
    );
  }
  return value;
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0 || value > 100000) {
    throw new NightlifeError("INVALID_REQUEST", "offset must be an integer between 0 and 100000.");
  }
  return value;
}

function isVipStatus(value: string): value is VipBookingStatus {
  return VIP_STATUSES.includes(value as VipBookingStatus);
}

function normalizeStatuses(input: VipBookingStatus[] | undefined): VipBookingStatus[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...DEFAULT_STATUSES];
  }

  const deduped: VipBookingStatus[] = [];
  for (const raw of input) {
    const normalized = String(raw || "").trim();
    if (!isVipStatus(normalized)) {
      throw new NightlifeError("INVALID_REQUEST", "statuses contains an invalid value.");
    }
    if (!deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  }

  return deduped.length ? deduped : [...DEFAULT_STATUSES];
}

function isVipAgentTaskStatus(value: string): value is VipAgentTaskStatus {
  return VIP_AGENT_TASK_STATUSES.includes(value as VipAgentTaskStatus);
}

function isVipEventActorType(
  value: string,
): value is "customer" | "agent" | "ops" | "system" {
  return ["customer", "agent", "ops", "system"].includes(value);
}

function normalizeActor(input: string): string {
  const normalized = String(input || "").trim();
  if (!normalized) {
    throw new NightlifeError("INVALID_REQUEST", "editor_username cannot be blank.");
  }
  return normalized.slice(0, 128);
}

function normalizeOptionalText(
  input: string | null | undefined,
  field: string,
  maxLength: number,
): string | null {
  if (input === undefined) {
    return null;
  }

  if (input === null) {
    return null;
  }

  const normalized = String(input).trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new NightlifeError("INVALID_REQUEST", `${field} exceeds ${maxLength} characters.`);
  }

  return normalized;
}

function normalizeRequiredText(input: string, field: string, maxLength: number): string {
  const normalized = String(input || "").trim();
  if (!normalized) {
    throw new NightlifeError("INVALID_REQUEST", `${field} cannot be blank.`);
  }
  if (normalized.length > maxLength) {
    throw new NightlifeError("INVALID_REQUEST", `${field} exceeds ${maxLength} characters.`);
  }
  return normalized;
}

function normalizePatch(patch: UpdateVipAdminBookingPatch): Record<string, unknown> {
  if (!patch || typeof patch !== "object") {
    throw new NightlifeError("INVALID_REQUEST", "patch object is required.");
  }

  const output: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(patch, "status")) {
    const status = String(patch.status || "").trim();
    if (!isVipStatus(status)) {
      throw new NightlifeError("INVALID_REQUEST", "status is invalid.");
    }
    output.status = status;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "status_message")) {
    output.status_message = normalizeRequiredText(
      String(patch.status_message || ""),
      "status_message",
      400,
    );
  }

  if (Object.prototype.hasOwnProperty.call(patch, "agent_internal_note")) {
    output.agent_internal_note = normalizeOptionalText(
      patch.agent_internal_note,
      "agent_internal_note",
      2000,
    );
  }

  if (Object.prototype.hasOwnProperty.call(patch, "booking_date")) {
    const bookingDate = normalizeOptionalDate(patch.booking_date, "booking_date");
    if (!bookingDate) {
      throw new NightlifeError("INVALID_REQUEST", "booking_date cannot be blank.");
    }
    output.booking_date = bookingDate;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "arrival_time")) {
    const arrivalTime = String(patch.arrival_time || "").trim();
    if (!TIME_RE.test(arrivalTime)) {
      throw new NightlifeError(
        "INVALID_REQUEST",
        "arrival_time must use HH:MM 24-hour format.",
      );
    }
    output.arrival_time = arrivalTime;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "party_size")) {
    if (!Number.isInteger(patch.party_size) || patch.party_size! < 1 || patch.party_size! > 30) {
      throw new NightlifeError("INVALID_REQUEST", "party_size must be between 1 and 30.");
    }
    output.party_size = patch.party_size;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "special_requests")) {
    output.special_requests = normalizeOptionalText(
      patch.special_requests,
      "special_requests",
      2000,
    );
  }

  if (Object.keys(output).length === 0) {
    throw new NightlifeError("INVALID_REQUEST", "patch must include at least one editable field.");
  }

  return output;
}

async function buildBookingSummaries(
  supabase: SupabaseClient,
  reservations: VipBookingRequestRow[],
): Promise<VipAdminBookingSummary[]> {
  if (reservations.length === 0) {
    return [];
  }

  const bookingRequestIds = reservations.map((row) => row.id);
  const venueIds = [...new Set(reservations.map((row) => row.venue_id))];

  const { data: venueRows, error: venueError } = await supabase
    .from("venues")
    .select("id,name")
    .in("id", venueIds);
  if (venueError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load venue names.", {
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
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP booking event context.", {
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
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP booking task context.", {
      cause: taskError.message,
    });
  }

  const latestTaskByBooking = new Map<string, VipReservationTaskRow>();
  for (const row of (taskRows || []) as VipReservationTaskRow[]) {
    if (!latestTaskByBooking.has(row.booking_request_id)) {
      latestTaskByBooking.set(row.booking_request_id, row);
    }
  }

  return reservations
    .filter(
      (row): row is VipBookingRequestRow & { status: VipBookingStatus } =>
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
        agent_internal_note: row.agent_internal_note,
        booking_date: row.booking_date,
        arrival_time: row.arrival_time,
        party_size: row.party_size,
        customer_name: row.customer_name,
        customer_email: row.customer_email,
        customer_phone: row.customer_phone,
        special_requests: row.special_requests,
        preferred_table_code: row.preferred_table_code,
        min_spend: row.min_spend,
        min_spend_currency: row.min_spend_currency,
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
}

export async function listVipAdminBookings(
  supabase: SupabaseClient,
  input: ListVipAdminBookingsInput,
): Promise<VipAdminBookingListResult> {
  const statuses = normalizeStatuses(input.statuses);
  const bookingDateFrom = normalizeOptionalDate(input.booking_date_from, "booking_date_from");
  const bookingDateTo = normalizeOptionalDate(input.booking_date_to, "booking_date_to");
  const search = normalizeOptionalSearch(input.search);
  const limit = normalizeLimit(input.limit);
  const offset = normalizeOffset(input.offset);
  const now = new Date().toISOString();

  if (bookingDateFrom && bookingDateTo && bookingDateFrom > bookingDateTo) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "booking_date_from cannot be after booking_date_to.",
    );
  }

  let query = supabase
    .from("vip_booking_requests")
    .select(
      "id,status,status_message,agent_internal_note,booking_date,arrival_time,party_size,customer_name,customer_email,customer_phone,special_requests,preferred_table_code,min_spend,min_spend_currency,venue_id,created_at,updated_at",
      { count: "exact" },
    )
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (bookingDateFrom) {
    query = query.gte("booking_date", bookingDateFrom);
  }
  if (bookingDateTo) {
    query = query.lte("booking_date", bookingDateTo);
  }
  if (search) {
    query = query.or(
      `customer_name.ilike.%${search}%,customer_email.ilike.%${search}%,customer_phone.ilike.%${search}%`,
    );
  }

  const { data, count, error } = await query;
  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP bookings.", {
      cause: error.message,
    });
  }

  const rows = Array.isArray(data) ? (data as VipBookingRequestRow[]) : [];
  const bookings = await buildBookingSummaries(supabase, rows);

  return {
    now,
    total_count: count || 0,
    count: bookings.length,
    limit,
    offset,
    statuses,
    bookings,
  };
}

export async function listVipAdminVenues(
  supabase: SupabaseClient,
): Promise<VipAdminVenueListResult> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("venues")
    .select("id,name,city,vip_booking_enabled")
    .eq("vip_booking_enabled", true)
    .order("name", { ascending: true })
    .limit(500);

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP-enabled venues.", {
      cause: error.message,
    });
  }

  const rows = Array.isArray(data) ? (data as VipVenueOptionRow[]) : [];
  const venues = rows.map((row) => ({
    venue_id: row.id,
    venue_name: row.name || row.id,
    city_name: row.city || null,
  }));

  return {
    now,
    count: venues.length,
    venues,
  };
}

export async function getVipAdminBookingDetail(
  supabase: SupabaseClient,
  bookingRequestIdInput: string,
): Promise<VipAdminBookingDetailResult> {
  const bookingRequestId = ensureUuid(bookingRequestIdInput, "booking_request_id");

  const { data: bookingRow, error: bookingError } = await supabase
    .from("vip_booking_requests")
    .select(
      "id,status,status_message,agent_internal_note,booking_date,arrival_time,party_size,customer_name,customer_email,customer_phone,special_requests,preferred_table_code,min_spend,min_spend_currency,venue_id,created_at,updated_at",
    )
    .eq("id", bookingRequestId)
    .maybeSingle<VipBookingRequestRow>();

  if (bookingError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load VIP booking request.", {
      cause: bookingError.message,
    });
  }

  if (!bookingRow) {
    throw new NightlifeError("BOOKING_REQUEST_NOT_FOUND", "VIP booking request not found.");
  }

  const [booking] = await buildBookingSummaries(supabase, [bookingRow]);

  const { data: historyRows, error: historyError } = await supabase
    .from("vip_booking_status_events")
    .select("to_status,actor_type,note,created_at")
    .eq("booking_request_id", bookingRequestId)
    .order("created_at", { ascending: true });

  if (historyError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load booking history.", {
      cause: historyError.message,
    });
  }

  const history: VipAdminBookingHistoryEntry[] = ((historyRows || []) as VipStatusEventHistoryRow[])
    .filter((row) => isVipStatus(row.to_status))
    .map((row) => ({
      status: row.to_status as VipBookingStatus,
      at: row.created_at,
      actor_type: isVipEventActorType(row.actor_type) ? row.actor_type : null,
      note: row.note,
    }));

  const { data: auditRows, error: auditError } = await supabase
    .from("vip_booking_edit_audits")
    .select("id,editor_username,change_note,changed_fields,before_values,after_values,created_at")
    .eq("booking_request_id", bookingRequestId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (auditError) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load booking audits.", {
      cause: auditError.message,
    });
  }

  const audits: VipBookingEditAuditEntry[] = ((auditRows || []) as VipEditAuditRow[]).map((row) => ({
    audit_id: row.id,
    editor_username: row.editor_username,
    change_note: row.change_note,
    changed_fields: Array.isArray(row.changed_fields) ? row.changed_fields : [],
    before_values:
      row.before_values && typeof row.before_values === "object"
        ? row.before_values
        : {},
    after_values:
      row.after_values && typeof row.after_values === "object"
        ? row.after_values
        : {},
    created_at: row.created_at,
  }));

  return {
    now: new Date().toISOString(),
    booking,
    history,
    audits,
  };
}

export type VipAdminBookingOptions = {
  stripeSecretKey?: string;
  nightlifeBaseUrl?: string;
  resendApiKey?: string;
};

export async function updateVipAdminBooking(
  supabase: SupabaseClient,
  input: UpdateVipAdminBookingInput,
  options?: VipAdminBookingOptions,
): Promise<VipAdminBookingUpdateResult> {
  const bookingRequestId = ensureUuid(input.booking_request_id, "booking_request_id");
  const editorUsername = normalizeActor(input.editor_username);
  const patch = normalizePatch(input.patch);
  const note = normalizeOptionalText(input.note, "note", 400);

  const { data, error } = await supabase.rpc("admin_update_vip_booking_request", {
    p_booking_request_id: bookingRequestId,
    p_editor_username: editorUsername,
    p_patch: patch,
    p_note: note,
  });

  if (error) {
    const message = String(error.message || "");
    if (message.toLowerCase().includes("not found")) {
      throw new NightlifeError("BOOKING_REQUEST_NOT_FOUND", "VIP booking request not found.");
    }
    if (
      message.toLowerCase().includes("invalid") ||
      message.toLowerCase().includes("must") ||
      message.toLowerCase().includes("cannot")
    ) {
      throw new NightlifeError("INVALID_REQUEST", message || "Invalid booking edit payload.");
    }

    throw new NightlifeError("BOOKING_STATUS_UPDATE_FAILED", "Failed to update VIP booking.", {
      cause: message,
    });
  }

  const rpcRow = Array.isArray(data) ? (data[0] as AdminUpdateRpcRow | undefined) : undefined;
  if (!rpcRow) {
    throw new NightlifeError("BOOKING_STATUS_UPDATE_FAILED", "Failed to update VIP booking.");
  }

  const changedFields = Array.isArray(rpcRow.changed_fields) ? rpcRow.changed_fields : [];

  // If status changed via admin dashboard, handle deposit creation + emails
  if (changedFields.includes("status") && patch.status) {
    const newStatus = patch.status as VipBookingStatus;

    if (newStatus === "deposit_required" && options?.stripeSecretKey && options?.nightlifeBaseUrl) {
      try {
        const { createDepositForBooking } = await import("./deposits.js");
        await createDepositForBooking(supabase, bookingRequestId, options.stripeSecretKey, options.nightlifeBaseUrl);
      } catch {
        // Deposit creation failure is non-blocking for admin
      }
    }

    if (options?.resendApiKey) {
      try {
        const { sendDepositRequiredEmail, sendBookingConfirmedEmail, sendBookingRejectedEmail } =
          await import("./email.js");

        if (newStatus === "deposit_required") {
          const { getDepositForBooking } = await import("./deposits.js");
          const deposit = await getDepositForBooking(supabase, bookingRequestId);
          if (deposit?.stripe_checkout_url && deposit.checkout_expires_at) {
            await sendDepositRequiredEmail(
              supabase, options.resendApiKey, bookingRequestId,
              deposit.amount_jpy, deposit.stripe_checkout_url, deposit.checkout_expires_at,
            );
          }
        } else if (newStatus === "confirmed") {
          await sendBookingConfirmedEmail(supabase, options.resendApiKey, bookingRequestId, false);
        } else if (newStatus === "rejected") {
          await sendBookingRejectedEmail(supabase, options.resendApiKey, bookingRequestId);
        }
      } catch {
        // Email failure is non-blocking
      }
    }
  }

  const detail = await getVipAdminBookingDetail(supabase, bookingRequestId);

  return {
    booking: detail.booking,
    changed_fields: changedFields,
    audit_id: rpcRow.audit_id,
    updated_at: rpcRow.updated_at,
  };
}

export async function createVipAdminBooking(
  supabase: SupabaseClient,
  input: CreateVipAdminBookingInput,
  options?: VipAdminBookingOptions,
): Promise<VipBookingCreateResult> {
  // Reuse the exact flow used by MCP tool `create_vip_booking_request`.
  return createVipBookingRequest(supabase, input, {
    resendApiKey: options?.resendApiKey,
  });
}
