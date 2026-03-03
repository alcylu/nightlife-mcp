import test from "node:test";
import assert from "node:assert/strict";
import { NightlifeError } from "../errors.js";
import {
  getVipAdminBookingDetail,
  listVipAdminBookings,
  updateVipAdminBooking,
} from "./vipAdmin.js";

test("listVipAdminBookings defaults to all statuses and maps booking context", async () => {
  const supabase = {
    from: (table: string) => {
      if (table === "vip_booking_requests") {
        return {
          select: () => ({
            in: (_column: string, statuses: string[]) => {
              assert.deepEqual(statuses, [
                "submitted",
                "in_review",
                "confirmed",
                "rejected",
                "cancelled",
              ]);
              return {
                order: () => ({
                  range: async () => ({
                    data: [
                      {
                        id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
                        status: "submitted",
                        status_message: "Pending venue confirmation",
                        agent_internal_note: "Need booth",
                        booking_date: "2026-03-05",
                        arrival_time: "22:00:00",
                        party_size: 4,
                        customer_name: "Jane",
                        customer_email: "jane@example.com",
                        customer_phone: "+14155550101",
                        special_requests: "Birthday",
                        preferred_table_code: "T1",
                        min_spend: 250000,
                        min_spend_currency: "JPY",
                        venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                        created_at: "2026-03-03T01:00:00.000Z",
                        updated_at: "2026-03-03T01:00:00.000Z",
                      },
                    ],
                    count: 1,
                    error: null,
                  }),
                }),
              };
            },
          }),
        };
      }

      if (table === "venues") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                  name: "Zouk",
                },
              ],
              error: null,
            }),
          }),
        };
      }

      if (table === "vip_booking_status_events") {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: [
                  {
                    booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
                    actor_type: "customer",
                    note: "Submitted by user",
                    created_at: "2026-03-03T01:00:10.000Z",
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_agent_tasks") {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: [
                  {
                    id: "a7a14ec4-a885-4678-8f2e-47b5f8c2959b",
                    booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
                    status: "pending",
                    attempt_count: 1,
                    next_attempt_at: "2026-03-03T01:05:00.000Z",
                    claimed_by: null,
                    claimed_at: null,
                    alert_count: 0,
                    last_alerted_at: null,
                    updated_at: "2026-03-03T01:00:20.000Z",
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as any;

  const result = await listVipAdminBookings(supabase, {});

  assert.equal(result.total_count, 1);
  assert.equal(result.count, 1);
  assert.equal(result.bookings[0].venue_name, "Zouk");
  assert.equal(result.bookings[0].latest_task?.status, "pending");
});

test("getVipAdminBookingDetail returns booking, history, and audits", async () => {
  const supabase = {
    from: (table: string) => {
      if (table === "vip_booking_requests") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
                  status: "in_review",
                  status_message: "Under review",
                  agent_internal_note: null,
                  booking_date: "2026-03-05",
                  arrival_time: "22:00:00",
                  party_size: 5,
                  customer_name: "Alex",
                  customer_email: "alex@example.com",
                  customer_phone: "+14155550155",
                  special_requests: null,
                  preferred_table_code: null,
                  min_spend: null,
                  min_spend_currency: "JPY",
                  venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                  created_at: "2026-03-03T01:00:00.000Z",
                  updated_at: "2026-03-03T01:30:00.000Z",
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "venues") {
        return {
          select: () => ({
            in: async () => ({
              data: [{ id: "d290f1ee-6c54-4b01-90e6-d701748f0851", name: "Womb" }],
              error: null,
            }),
          }),
        };
      }

      if (table === "vip_booking_status_events") {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: [
                  {
                    booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
                    actor_type: "agent",
                    note: "Picked up",
                    created_at: "2026-03-03T01:05:00.000Z",
                  },
                ],
                error: null,
              }),
            }),
            eq: () => ({
              order: async () => ({
                data: [
                  {
                    to_status: "submitted",
                    actor_type: "customer",
                    note: "Created",
                    created_at: "2026-03-03T01:00:00.000Z",
                  },
                  {
                    to_status: "in_review",
                    actor_type: "agent",
                    note: "Picked up",
                    created_at: "2026-03-03T01:05:00.000Z",
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_agent_tasks") {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: [],
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_booking_edit_audits") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: "f5d0ca72-8f6f-4b2f-a57f-96f2d0b80ed8",
                      editor_username: "ops-1",
                      change_note: "Manual correction",
                      changed_fields: ["party_size"],
                      before_values: { party_size: 4 },
                      after_values: { party_size: 5 },
                      created_at: "2026-03-03T01:31:00.000Z",
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as any;

  const result = await getVipAdminBookingDetail(
    supabase,
    "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
  );

  assert.equal(result.booking.status, "in_review");
  assert.equal(result.history.length, 2);
  assert.equal(result.audits.length, 1);
  assert.equal(result.audits[0].editor_username, "ops-1");
});

test("updateVipAdminBooking rejects empty patch", async () => {
  await assert.rejects(
    async () =>
      updateVipAdminBooking({} as any, {
        booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
        editor_username: "ops-1",
        patch: {},
      }),
    (error) =>
      error instanceof NightlifeError &&
      error.code === "INVALID_REQUEST" &&
      error.message.includes("at least one editable field"),
  );
});

test("updateVipAdminBooking maps not found RPC errors", async () => {
  const supabase = {
    rpc: async () => ({
      data: null,
      error: { message: "VIP booking request not found" },
    }),
  } as any;

  await assert.rejects(
    async () =>
      updateVipAdminBooking(supabase, {
        booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
        editor_username: "ops-1",
        patch: {
          status: "confirmed",
        },
      }),
    (error) =>
      error instanceof NightlifeError &&
      error.code === "BOOKING_REQUEST_NOT_FOUND",
  );
});
