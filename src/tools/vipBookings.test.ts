import test from "node:test";
import assert from "node:assert/strict";
import { NightlifeError, toolErrorResponse } from "../errors.js";
import {
  createVipBookingToolDescription,
  createVipBookingOutputSchema,
  vipBookingStatusOutputSchema,
} from "./vipBookings.js";

test("createVipBookingOutputSchema accepts phase-1 output shape", () => {
  const parsed = createVipBookingOutputSchema.parse({
    booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
    status: "submitted",
    created_at: "2026-02-27T12:00:00.000Z",
    message: "Your VIP booking request has been sent to the venue booking desk.",
    preferred_table_code: null,
    min_spend: null,
    min_spend_currency: null,
    table_warning: null,
  });

  assert.equal(parsed.status, "submitted");
});

test("vipBookingStatusOutputSchema accepts customer-safe status payload", () => {
  const parsed = vipBookingStatusOutputSchema.parse({
    booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
    status: "in_review",
    last_updated_at: "2026-02-27T13:00:00.000Z",
    status_message: "Still confirming with promoter.",
    latest_note: "Checking promoter availability.",
    history: [
      {
        status: "submitted",
        at: "2026-02-27T12:00:00.000Z",
        note: "Request submitted.",
      },
      {
        status: "in_review",
        at: "2026-02-27T12:10:00.000Z",
        note: "Checking promoter availability.",
      },
    ],
    deposit_status: null,
    deposit_amount_jpy: null,
    deposit_payment_url: null,
  });

  assert.equal(parsed.history.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "agent_internal_note"), false);
});

test("toolErrorResponse supports VIP booking error codes", () => {
  const payload = toolErrorResponse(
    new NightlifeError("BOOKING_REQUEST_NOT_FOUND", "VIP booking request not found."),
  );

  assert.deepEqual(payload, {
    error: {
      code: "BOOKING_REQUEST_NOT_FOUND",
      message: "VIP booking request not found.",
    },
  });
});

test("create_vip_booking_request description enforces dual-date late-night confirmation", () => {
  assert.match(createVipBookingToolDescription, /dual-date wording/i);
  assert.match(createVipBookingToolDescription, /00:00 to 05:59/i);
  assert.match(createVipBookingToolDescription, /Just to confirm:/i);
  assert.match(
    createVipBookingToolDescription,
    /Do you mean 2:00 AM after Thursday night \(Friday morning\), or after Friday night \(Saturday morning\)\?/i,
  );
});
