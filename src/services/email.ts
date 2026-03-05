import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { logEvent } from "../observability/metrics.js";
import {
  type BookingEmailData,
  emailLayout,
  bookingSubmittedContent,
  depositRequiredContent,
  bookingConfirmedContent,
  bookingRejectedContent,
  bookingCancelledContent,
  depositExpiredContent,
  depositRefundedContent,
  depositLinkRegeneratedContent,
} from "../emails/templates.js";

let resendInstance: Resend | null = null;

function getResend(apiKey: string): Resend {
  if (!resendInstance) {
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
}

const FROM_ADDRESS = "Nightlife Tokyo VIP <vip@nightlifetokyo.com>";

export async function sendVipEmail(
  resendApiKey: string,
  options: { to: string; subject: string; html: string },
): Promise<void> {
  if (!resendApiKey) return;

  try {
    const resend = getResend(resendApiKey);
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    logEvent("email.sent", { to: options.to, subject: options.subject });
  } catch (err) {
    logEvent("email.send_failed", {
      to: options.to,
      subject: options.subject,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export async function fetchBookingEmailData(
  supabase: SupabaseClient,
  bookingRequestId: string,
): Promise<BookingEmailData | null> {
  const { data, error } = await supabase
    .from("vip_booking_requests")
    .select("id,customer_name,customer_email,booking_date,arrival_time,party_size,status_message,venue_id")
    .eq("id", bookingRequestId)
    .maybeSingle();

  if (error || !data) return null;

  const { data: venue } = await supabase
    .from("venues")
    .select("name")
    .eq("id", data.venue_id)
    .maybeSingle();

  return {
    bookingRequestId: data.id as string,
    customerName: data.customer_name as string,
    customerEmail: data.customer_email as string,
    venueName: (venue?.name as string) || "VIP Venue",
    bookingDate: data.booking_date as string,
    arrivalTime: data.arrival_time as string,
    partySize: data.party_size as number,
    statusMessage: (data.status_message as string) || undefined,
  };
}

export async function sendBookingSubmittedEmail(
  supabase: SupabaseClient,
  resendApiKey: string,
  bookingRequestId: string,
): Promise<void> {
  const data = await fetchBookingEmailData(supabase, bookingRequestId);
  if (!data) return;
  await sendVipEmail(resendApiKey, {
    to: data.customerEmail,
    subject: `VIP Request Received — ${data.venueName}`,
    html: emailLayout(bookingSubmittedContent(data)),
  });
}

export async function sendDepositRequiredEmail(
  supabase: SupabaseClient,
  resendApiKey: string,
  bookingRequestId: string,
  depositAmountJpy: number,
  checkoutUrl: string,
  expiresAt: string,
): Promise<void> {
  const data = await fetchBookingEmailData(supabase, bookingRequestId);
  if (!data) return;
  await sendVipEmail(resendApiKey, {
    to: data.customerEmail,
    subject: `VIP Table Available — Deposit Required — ${data.venueName}`,
    html: emailLayout(depositRequiredContent({ ...data, depositAmountJpy, checkoutUrl, expiresAt })),
  });
}

export async function sendBookingConfirmedEmail(
  supabase: SupabaseClient,
  resendApiKey: string,
  bookingRequestId: string,
  depositPaid?: boolean,
): Promise<void> {
  const data = await fetchBookingEmailData(supabase, bookingRequestId);
  if (!data) return;
  await sendVipEmail(resendApiKey, {
    to: data.customerEmail,
    subject: `VIP Table Confirmed — ${data.venueName}`,
    html: emailLayout(bookingConfirmedContent({ ...data, depositPaid })),
  });
}

export async function sendBookingRejectedEmail(
  supabase: SupabaseClient,
  resendApiKey: string,
  bookingRequestId: string,
): Promise<void> {
  const data = await fetchBookingEmailData(supabase, bookingRequestId);
  if (!data) return;
  await sendVipEmail(resendApiKey, {
    to: data.customerEmail,
    subject: `VIP Booking Update — ${data.venueName}`,
    html: emailLayout(bookingRejectedContent({ ...data, reason: data.statusMessage })),
  });
}

export async function sendBookingCancelledEmail(
  supabase: SupabaseClient,
  resendApiKey: string,
  bookingRequestId: string,
  depositOutcome?: string,
): Promise<void> {
  const data = await fetchBookingEmailData(supabase, bookingRequestId);
  if (!data) return;
  await sendVipEmail(resendApiKey, {
    to: data.customerEmail,
    subject: `VIP Booking Cancelled — ${data.venueName}`,
    html: emailLayout(bookingCancelledContent({ ...data, depositOutcome })),
  });
}

export async function sendDepositExpiredEmail(
  supabase: SupabaseClient,
  resendApiKey: string,
  bookingRequestId: string,
): Promise<void> {
  const data = await fetchBookingEmailData(supabase, bookingRequestId);
  if (!data) return;
  await sendVipEmail(resendApiKey, {
    to: data.customerEmail,
    subject: `Payment Link Expired — ${data.venueName}`,
    html: emailLayout(depositExpiredContent(data)),
  });
}

export async function sendDepositRefundedEmail(
  supabase: SupabaseClient,
  resendApiKey: string,
  bookingRequestId: string,
  refundAmountJpy: number,
  isPartial: boolean,
): Promise<void> {
  const data = await fetchBookingEmailData(supabase, bookingRequestId);
  if (!data) return;
  await sendVipEmail(resendApiKey, {
    to: data.customerEmail,
    subject: `Deposit Refund Processed — ${data.venueName}`,
    html: emailLayout(depositRefundedContent({ ...data, refundAmountJpy, isPartial })),
  });
}

export async function sendDepositLinkRegeneratedEmail(
  supabase: SupabaseClient,
  resendApiKey: string,
  bookingRequestId: string,
  checkoutUrl: string,
  expiresAt: string,
): Promise<void> {
  const data = await fetchBookingEmailData(supabase, bookingRequestId);
  if (!data) return;
  await sendVipEmail(resendApiKey, {
    to: data.customerEmail,
    subject: `New Payment Link — ${data.venueName}`,
    html: emailLayout(depositLinkRegeneratedContent({ ...data, checkoutUrl, expiresAt })),
  });
}
