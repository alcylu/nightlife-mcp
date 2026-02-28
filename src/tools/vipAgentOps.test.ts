import test from "node:test";
import assert from "node:assert/strict";
import { NightlifeError, toolErrorResponse } from "../errors.js";
import {
  claimVipRequestAfterAckOutputSchema,
  listVipReservationsOutputSchema,
  listVipRequestsForAlertingOutputSchema,
  markVipRequestAlertSentOutputSchema,
  updateVipBookingStatusOutputSchema,
} from "./vipAgentOps.js";

test("listVipRequestsForAlertingOutputSchema accepts alert payload", () => {
  const parsed = listVipRequestsForAlertingOutputSchema.parse({
    now: "2026-02-28T12:00:00.000Z",
    tasks: [
      {
        task_id: "a7a14ec4-a885-4678-8f2e-47b5f8c2959b",
        booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
        booking_date: "2026-03-01",
        arrival_time: "22:00:00",
        party_size: 4,
        customer_name: "Jane",
        customer_email: "jane@example.com",
        customer_phone: "+14155550101",
        special_requests: null,
        venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
        venue_name: "Zouk",
        current_status: "submitted",
        request_created_at: "2026-02-28T11:59:00.000Z",
        first_alerted_at: null,
        last_alerted_at: null,
        alert_count: 0,
        escalated_at: null,
        should_escalate: false,
      },
    ],
  });

  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].current_status, "submitted");
});

test("listVipReservationsOutputSchema accepts outstanding reservations payload", () => {
  const parsed = listVipReservationsOutputSchema.parse({
    now: "2026-02-28T12:00:00.000Z",
    count: 1,
    statuses: ["submitted", "in_review", "confirmed"],
    reservations: [
      {
        booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
        status: "submitted",
        status_message: "Your VIP booking request has been sent to the venue booking desk.",
        booking_date: "2026-03-01",
        arrival_time: "22:00:00",
        party_size: 4,
        customer_name: "Jane",
        customer_email: "jane@example.com",
        customer_phone: "+14155550101",
        special_requests: "Birthday setup",
        venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
        venue_name: "Zouk",
        created_at: "2026-02-28T11:59:00.000Z",
        updated_at: "2026-02-28T11:59:00.000Z",
        latest_event_note: "VIP booking request sent to venue booking desk.",
        latest_event_at: "2026-02-28T11:59:00.000Z",
        latest_event_actor_type: "customer",
        latest_task: {
          task_id: "a7a14ec4-a885-4678-8f2e-47b5f8c2959b",
          status: "pending",
          attempt_count: 1,
          next_attempt_at: "2026-02-28T12:05:00.000Z",
          claimed_by: null,
          claimed_at: null,
          alert_count: 1,
          last_alerted_at: "2026-02-28T12:00:00.000Z",
          updated_at: "2026-02-28T12:00:00.000Z",
        },
      },
    ],
  });

  assert.equal(parsed.count, 1);
  assert.equal(parsed.reservations[0].latest_task?.status, "pending");
});

test("markVipRequestAlertSentOutputSchema accepts retry payload", () => {
  const parsed = markVipRequestAlertSentOutputSchema.parse({
    task_id: "a7a14ec4-a885-4678-8f2e-47b5f8c2959b",
    status: "pending",
    first_alerted_at: "2026-02-28T12:00:00.000Z",
    last_alerted_at: "2026-02-28T12:00:00.000Z",
    alert_count: 4,
    escalated_at: null,
    next_attempt_at: "2026-02-28T12:05:00.000Z",
  });

  assert.equal(parsed.status, "pending");
  assert.equal(parsed.alert_count, 4);
});

test("claimVipRequestAfterAckOutputSchema accepts acknowledgement payload", () => {
  const parsed = claimVipRequestAfterAckOutputSchema.parse({
    task_id: "a7a14ec4-a885-4678-8f2e-47b5f8c2959b",
    task_status: "done",
    booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
    booking_status: "in_review",
    booking_status_message: "Your VIP request is now in review with the venue booking team.",
    booking_updated_at: "2026-02-28T12:03:00.000Z",
    acknowledged_by: "allen-line",
    acknowledged_channel: "line",
    acknowledged_session: "agent:allen:line:direct:U123",
    acknowledged_at: "2026-02-28T12:03:00.000Z",
  });

  assert.equal(parsed.task_status, "done");
  assert.equal(parsed.booking_status, "in_review");
});

test("updateVipBookingStatusOutputSchema accepts transition payload", () => {
  const parsed = updateVipBookingStatusOutputSchema.parse({
    booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
    status: "rejected",
    last_updated_at: "2026-02-28T12:08:00.000Z",
    status_message: "The venue cannot accommodate this request.",
  });

  assert.equal(parsed.status, "rejected");
  assert.equal(parsed.booking_request_id, "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd");
});

test("toolErrorResponse supports VIP ops error codes", () => {
  const payload = toolErrorResponse(
    new NightlifeError("VIP_TASK_NOT_AVAILABLE", "VIP alert task was already claimed."),
  );

  assert.deepEqual(payload, {
    error: {
      code: "VIP_TASK_NOT_AVAILABLE",
      message: "VIP alert task was already claimed.",
    },
  });
});
