import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { NightlifeError } from "../errors.js";
import type { VipDepositRecord, VipVenueDepositConfig } from "../types.js";
import {
  getStripe,
  createDepositCheckoutSession,
  createDepositRefund,
} from "./stripe.js";
import { logEvent } from "../observability/metrics.js";

// ── Types ──────────────────────────────────────────────────

export type UpsertVenueDepositConfigInput = {
  venue_id: string;
  deposit_enabled?: boolean;
  deposit_percentage?: number;
  refund_cutoff_hours?: number;
  partial_refund_percentage?: number;
  checkout_expiry_minutes?: number;
};

// ── Venue Config ───────────────────────────────────────────

export async function getVenueDepositConfig(
  supabase: SupabaseClient,
  venueId: string,
): Promise<VipVenueDepositConfig | null> {
  const { data, error } = await supabase
    .from("vip_venue_deposit_config")
    .select(
      "id,venue_id,deposit_enabled,deposit_percentage,refund_cutoff_hours,partial_refund_percentage,checkout_expiry_minutes",
    )
    .eq("venue_id", venueId)
    .maybeSingle();

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load venue deposit config.", {
      cause: error.message,
    });
  }

  return data as VipVenueDepositConfig | null;
}

export async function upsertVenueDepositConfig(
  supabase: SupabaseClient,
  input: UpsertVenueDepositConfigInput,
): Promise<VipVenueDepositConfig> {
  const existing = await getVenueDepositConfig(supabase, input.venue_id);

  const row = {
    venue_id: input.venue_id,
    deposit_enabled: input.deposit_enabled ?? existing?.deposit_enabled ?? true,
    deposit_percentage: input.deposit_percentage ?? existing?.deposit_percentage ?? 50,
    refund_cutoff_hours: input.refund_cutoff_hours ?? existing?.refund_cutoff_hours ?? 24,
    partial_refund_percentage:
      input.partial_refund_percentage ?? existing?.partial_refund_percentage ?? 0,
    checkout_expiry_minutes:
      input.checkout_expiry_minutes ?? existing?.checkout_expiry_minutes ?? 30,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error } = await supabase
      .from("vip_venue_deposit_config")
      .update(row)
      .eq("venue_id", input.venue_id)
      .select(
        "id,venue_id,deposit_enabled,deposit_percentage,refund_cutoff_hours,partial_refund_percentage,checkout_expiry_minutes",
      )
      .single();

    if (error || !data) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to update venue deposit config.", {
        cause: error?.message,
      });
    }
    return data as VipVenueDepositConfig;
  }

  const { data, error } = await supabase
    .from("vip_venue_deposit_config")
    .insert(row)
    .select(
      "id,venue_id,deposit_enabled,deposit_percentage,refund_cutoff_hours,partial_refund_percentage,checkout_expiry_minutes",
    )
    .single();

  if (error || !data) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to create venue deposit config.", {
      cause: error?.message,
    });
  }
  return data as VipVenueDepositConfig;
}

// ── Deposit CRUD ───────────────────────────────────────────

export async function getDepositForBooking(
  supabase: SupabaseClient,
  bookingRequestId: string,
): Promise<VipDepositRecord | null> {
  const { data, error } = await supabase
    .from("vip_booking_deposits")
    .select("*")
    .eq("booking_request_id", bookingRequestId)
    .maybeSingle();

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Failed to load deposit record.", {
      cause: error.message,
    });
  }

  return data as VipDepositRecord | null;
}

// ── Create Deposit on Confirmation ─────────────────────────

const STRIPE_MIN_AMOUNT_JPY = 50;

export async function createDepositForBooking(
  supabase: SupabaseClient,
  stripeSecretKey: string,
  bookingRequestId: string,
  nightlifeBaseUrl: string,
): Promise<VipDepositRecord | null> {
  // Load booking
  const { data: booking, error: bookingError } = await supabase
    .from("vip_booking_requests")
    .select("id,venue_id,min_spend,customer_email,booking_date,deposit_status")
    .eq("id", bookingRequestId)
    .single();

  if (bookingError || !booking) {
    throw new NightlifeError(
      "BOOKING_REQUEST_NOT_FOUND",
      "Booking not found for deposit creation.",
    );
  }

  // Skip if deposit already exists
  if (booking.deposit_status && booking.deposit_status !== "not_required") {
    logEvent("deposit.skipped", {
      booking_request_id: bookingRequestId,
      reason: "already_exists",
    });
    return null;
  }

  // Load venue deposit config
  const config = await getVenueDepositConfig(supabase, booking.venue_id as string);

  // No config or not enabled → not_required
  if (!config || !config.deposit_enabled) {
    await supabase
      .from("vip_booking_requests")
      .update({ deposit_status: "not_required" })
      .eq("id", bookingRequestId);
    logEvent("deposit.not_required", {
      booking_request_id: bookingRequestId,
      reason: "no_config",
    });
    return null;
  }

  // No min_spend → not_required
  const minSpend = booking.min_spend as number | null;
  if (!minSpend || minSpend <= 0) {
    await supabase
      .from("vip_booking_requests")
      .update({ deposit_status: "not_required" })
      .eq("id", bookingRequestId);
    logEvent("deposit.not_required", {
      booking_request_id: bookingRequestId,
      reason: "no_min_spend",
    });
    return null;
  }

  // Calculate amount
  const amountJpy = Math.round((minSpend * config.deposit_percentage) / 100);

  // Below Stripe minimum → not_required
  if (amountJpy < STRIPE_MIN_AMOUNT_JPY) {
    await supabase
      .from("vip_booking_requests")
      .update({ deposit_status: "not_required" })
      .eq("id", bookingRequestId);
    logEvent("deposit.not_required", {
      booking_request_id: bookingRequestId,
      reason: "below_minimum",
      amount_jpy: amountJpy,
    });
    return null;
  }

  // Load venue name for Stripe line item
  const { data: venue } = await supabase
    .from("venues")
    .select("name")
    .eq("id", booking.venue_id)
    .single();
  const venueName = (venue?.name as string) || "VIP Venue";

  // Create Stripe checkout session
  const stripe = getStripe(stripeSecretKey);
  const baseUrl = nightlifeBaseUrl.replace(/\/+$/, "");
  const session = await createDepositCheckoutSession(stripe, {
    amountJpy,
    customerEmail: booking.customer_email as string,
    bookingRequestId,
    venueName,
    bookingDate: booking.booking_date as string,
    expiryMinutes: config.checkout_expiry_minutes,
    successUrl: `${baseUrl}/deposit/success`,
    cancelUrl: `${baseUrl}/deposit/cancelled`,
  });

  // Insert deposit record
  const depositRow = {
    booking_request_id: bookingRequestId,
    venue_id: booking.venue_id,
    status: "pending" as const,
    amount_jpy: amountJpy,
    deposit_percentage: config.deposit_percentage,
    min_spend_jpy: minSpend,
    stripe_checkout_session_id: session.id,
    stripe_checkout_url: session.url,
    checkout_expires_at: session.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : null,
    refund_cutoff_hours: config.refund_cutoff_hours,
    partial_refund_percentage: config.partial_refund_percentage,
  };

  const { data: deposit, error: insertError } = await supabase
    .from("vip_booking_deposits")
    .insert(depositRow)
    .select("*")
    .single();

  if (insertError || !deposit) {
    throw new NightlifeError("DEPOSIT_CREATION_FAILED", "Failed to save deposit record.", {
      cause: insertError?.message,
    });
  }

  // Update booking deposit_status
  await supabase
    .from("vip_booking_requests")
    .update({ deposit_status: "pending" })
    .eq("id", bookingRequestId);

  logEvent("deposit.created", {
    booking_request_id: bookingRequestId,
    amount_jpy: amountJpy,
    stripe_session_id: session.id,
  });

  return deposit as VipDepositRecord;
}

// ── Webhook Handlers ───────────────────────────────────────

export async function handleCheckoutCompleted(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session,
  options?: { resendApiKey?: string },
): Promise<void> {
  const bookingRequestId = session.metadata?.booking_request_id;
  if (!bookingRequestId) {
    logEvent("deposit.webhook.no_metadata", { session_id: session.id });
    return;
  }

  const { error } = await supabase
    .from("vip_booking_deposits")
    .update({
      status: "paid",
      stripe_payment_intent_id:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent as { id: string } | null)?.id || null,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("booking_request_id", bookingRequestId)
    .eq("status", "pending");

  if (error) {
    logEvent("deposit.webhook.update_failed", {
      booking_request_id: bookingRequestId,
      cause: error.message,
    });
    return;
  }

  await supabase
    .from("vip_booking_requests")
    .update({ deposit_status: "paid" })
    .eq("id", bookingRequestId);

  // Auto-confirm booking when deposit is paid
  const { data: booking } = await supabase
    .from("vip_booking_requests")
    .select("id,status")
    .eq("id", bookingRequestId)
    .single();

  if (booking?.status === "deposit_required") {
    await supabase
      .from("vip_booking_requests")
      .update({ status: "confirmed", status_message: "Deposit paid. Your VIP table is confirmed." })
      .eq("id", bookingRequestId);

    await supabase.from("vip_booking_status_events").insert({
      booking_request_id: bookingRequestId,
      from_status: "deposit_required",
      to_status: "confirmed",
      actor_type: "system",
      note: "Auto-confirmed after deposit payment.",
    });

    // Settle agent tasks (now terminal)
    await supabase
      .from("vip_agent_tasks")
      .update({ status: "done", last_error: null })
      .eq("booking_request_id", bookingRequestId)
      .in("status", ["pending", "claimed"]);
  } else {
    // Audit trail for deposit paid on already-confirmed booking
    await supabase.from("vip_booking_status_events").insert({
      booking_request_id: bookingRequestId,
      from_status: booking?.status ?? "confirmed",
      to_status: booking?.status ?? "confirmed",
      actor_type: "system",
      note: "Deposit payment received.",
    });
  }

  // Send confirmed email with deposit paid flag
  if (options?.resendApiKey) {
    try {
      const { sendBookingConfirmedEmail } = await import("./email.js");
      await sendBookingConfirmedEmail(supabase, options.resendApiKey, bookingRequestId, true);
    } catch (emailError) {
      logEvent("deposit.email_error", {
        booking_request_id: bookingRequestId,
        error: emailError instanceof Error ? emailError.message : "Unknown error",
      });
    }
  }

  logEvent("deposit.paid", { booking_request_id: bookingRequestId });
}

export async function handleCheckoutExpired(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session,
  options?: { resendApiKey?: string },
): Promise<void> {
  const bookingRequestId = session.metadata?.booking_request_id;
  if (!bookingRequestId) {
    return;
  }

  const { error } = await supabase
    .from("vip_booking_deposits")
    .update({
      status: "expired",
      updated_at: new Date().toISOString(),
    })
    .eq("booking_request_id", bookingRequestId)
    .eq("status", "pending");

  if (error) {
    logEvent("deposit.webhook.expire_failed", {
      booking_request_id: bookingRequestId,
      cause: error.message,
    });
    return;
  }

  await supabase
    .from("vip_booking_requests")
    .update({ deposit_status: "expired" })
    .eq("id", bookingRequestId);

  if (options?.resendApiKey) {
    try {
      const { sendDepositExpiredEmail } = await import("./email.js");
      await sendDepositExpiredEmail(supabase, options.resendApiKey, bookingRequestId);
    } catch (emailError) {
      logEvent("deposit.email_error", {
        booking_request_id: bookingRequestId,
        error: emailError instanceof Error ? emailError.message : "Unknown error",
      });
    }
  }

  logEvent("deposit.expired", { booking_request_id: bookingRequestId });
}

// ── Refund on Cancellation ─────────────────────────────────

export async function processRefundOnCancellation(
  supabase: SupabaseClient,
  stripeSecretKey: string,
  bookingRequestId: string,
  options?: { resendApiKey?: string },
): Promise<void> {
  const deposit = await getDepositForBooking(supabase, bookingRequestId);

  if (!deposit || deposit.status !== "paid") {
    return;
  }

  if (!deposit.stripe_payment_intent_id) {
    logEvent("deposit.refund.no_payment_intent", { booking_request_id: bookingRequestId });
    return;
  }

  const { data: booking } = await supabase
    .from("vip_booking_requests")
    .select("booking_date")
    .eq("id", bookingRequestId)
    .single();

  if (!booking) {
    logEvent("deposit.refund.booking_not_found", { booking_request_id: bookingRequestId });
    return;
  }

  // Hours until booking (noon JST as reference)
  const bookingDateStr = booking.booking_date as string;
  const bookingNoonUtc = new Date(`${bookingDateStr}T12:00:00+09:00`);
  const now = new Date();
  const hoursUntilBooking = (bookingNoonUtc.getTime() - now.getTime()) / (1000 * 60 * 60);

  const stripe = getStripe(stripeSecretKey);

  if (hoursUntilBooking >= deposit.refund_cutoff_hours) {
    // Full refund
    try {
      const refund = await createDepositRefund(
        stripe,
        deposit.stripe_payment_intent_id,
        deposit.amount_jpy,
      );

      await supabase
        .from("vip_booking_deposits")
        .update({
          status: "refunded",
          refund_amount_jpy: deposit.amount_jpy,
          stripe_refund_id: refund.id,
          refunded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", deposit.id);

      await supabase
        .from("vip_booking_requests")
        .update({ deposit_status: "refunded" })
        .eq("id", bookingRequestId);

      logEvent("deposit.refunded", {
        booking_request_id: bookingRequestId,
        amount_jpy: deposit.amount_jpy,
      });

      if (options?.resendApiKey) {
        try {
          const { sendDepositRefundedEmail } = await import("./email.js");
          await sendDepositRefundedEmail(supabase, options.resendApiKey, bookingRequestId, deposit.amount_jpy, false);
        } catch {}
      }
    } catch (err) {
      logEvent("deposit.refund.stripe_error", {
        booking_request_id: bookingRequestId,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  } else if (deposit.partial_refund_percentage > 0) {
    // Partial refund
    const partialAmount = Math.round(
      (deposit.amount_jpy * deposit.partial_refund_percentage) / 100,
    );

    if (partialAmount >= STRIPE_MIN_AMOUNT_JPY) {
      try {
        const refund = await createDepositRefund(
          stripe,
          deposit.stripe_payment_intent_id,
          partialAmount,
        );

        await supabase
          .from("vip_booking_deposits")
          .update({
            status: "partially_refunded",
            refund_amount_jpy: partialAmount,
            stripe_refund_id: refund.id,
            refunded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", deposit.id);

        await supabase
          .from("vip_booking_requests")
          .update({ deposit_status: "partially_refunded" })
          .eq("id", bookingRequestId);

        logEvent("deposit.partially_refunded", {
          booking_request_id: bookingRequestId,
          amount_jpy: partialAmount,
        });

        if (options?.resendApiKey) {
          try {
            const { sendDepositRefundedEmail } = await import("./email.js");
            await sendDepositRefundedEmail(supabase, options.resendApiKey, bookingRequestId, partialAmount, true);
          } catch {}
        }
      } catch (err) {
        logEvent("deposit.refund.stripe_error", {
          booking_request_id: bookingRequestId,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    } else {
      await forfeitDeposit(supabase, deposit.id, bookingRequestId);
    }
  } else {
    await forfeitDeposit(supabase, deposit.id, bookingRequestId);
  }
}

async function forfeitDeposit(
  supabase: SupabaseClient,
  depositId: string,
  bookingRequestId: string,
): Promise<void> {
  await supabase
    .from("vip_booking_deposits")
    .update({
      status: "forfeited",
      forfeited_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", depositId);

  await supabase
    .from("vip_booking_requests")
    .update({ deposit_status: "forfeited" })
    .eq("id", bookingRequestId);

  logEvent("deposit.forfeited", { booking_request_id: bookingRequestId });
}

// ── Regenerate Expired Checkout ────────────────────────────

export async function regenerateDepositCheckout(
  supabase: SupabaseClient,
  stripeSecretKey: string,
  bookingRequestId: string,
  nightlifeBaseUrl: string,
  options?: { resendApiKey?: string },
): Promise<VipDepositRecord> {
  const deposit = await getDepositForBooking(supabase, bookingRequestId);

  if (!deposit) {
    throw new NightlifeError("DEPOSIT_NOT_FOUND", "No deposit found for this booking.");
  }

  if (deposit.status !== "expired") {
    throw new NightlifeError(
      "INVALID_BOOKING_REQUEST",
      `Cannot regenerate checkout for deposit with status "${deposit.status}". Only expired deposits can be regenerated.`,
    );
  }

  const config = await getVenueDepositConfig(supabase, deposit.venue_id);
  const expiryMinutes = config?.checkout_expiry_minutes ?? 30;

  const { data: booking } = await supabase
    .from("vip_booking_requests")
    .select("customer_email,booking_date")
    .eq("id", bookingRequestId)
    .single();

  if (!booking) {
    throw new NightlifeError("BOOKING_REQUEST_NOT_FOUND", "Booking not found.");
  }

  const { data: venue } = await supabase
    .from("venues")
    .select("name")
    .eq("id", deposit.venue_id)
    .single();
  const venueName = (venue?.name as string) || "VIP Venue";

  const stripe = getStripe(stripeSecretKey);
  const baseUrl = nightlifeBaseUrl.replace(/\/+$/, "");
  const session = await createDepositCheckoutSession(stripe, {
    amountJpy: deposit.amount_jpy,
    customerEmail: booking.customer_email as string,
    bookingRequestId,
    venueName,
    bookingDate: booking.booking_date as string,
    expiryMinutes,
    successUrl: `${baseUrl}/deposit/success`,
    cancelUrl: `${baseUrl}/deposit/cancelled`,
  });

  const { data: updated, error } = await supabase
    .from("vip_booking_deposits")
    .update({
      status: "pending",
      stripe_checkout_session_id: session.id,
      stripe_checkout_url: session.url,
      checkout_expires_at: session.expires_at
        ? new Date(session.expires_at * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deposit.id)
    .select("*")
    .single();

  if (error || !updated) {
    throw new NightlifeError(
      "DEPOSIT_CREATION_FAILED",
      "Failed to update deposit with new checkout session.",
      { cause: error?.message },
    );
  }

  await supabase
    .from("vip_booking_requests")
    .update({ deposit_status: "pending" })
    .eq("id", bookingRequestId);

  if (options?.resendApiKey && updated.stripe_checkout_url && updated.checkout_expires_at) {
    try {
      const { sendDepositLinkRegeneratedEmail } = await import("./email.js");
      await sendDepositLinkRegeneratedEmail(supabase, options.resendApiKey, bookingRequestId, updated.stripe_checkout_url as string, updated.checkout_expires_at as string);
    } catch (emailError) {
      logEvent("deposit.email_error", {
        booking_request_id: bookingRequestId,
        error: emailError instanceof Error ? emailError.message : "Unknown error",
      });
    }
  }

  logEvent("deposit.regenerated", {
    booking_request_id: bookingRequestId,
    stripe_session_id: session.id,
  });

  return updated as VipDepositRecord;
}
