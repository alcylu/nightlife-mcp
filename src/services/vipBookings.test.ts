import test from "node:test";
import assert from "node:assert/strict";
import { NightlifeError } from "../errors.js";
import {
  claimVipRequestAfterAck,
  claimNextVipAgentTask,
  createVipBookingRequest,
  getVipBookingStatus,
  isAllowedVipStatusTransition,
  listVipReservations,
  listVipRequestsForAlerting,
  markVipRequestAlertSent,
  updateVipBookingStatus,
} from "./vipBookings.js";

function isoDateFromNow(daysFromNow: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

test("createVipBookingRequest creates request and enqueues agent task", async () => {
  const inserts: Record<string, unknown[]> = {
    vip_booking_requests: [],
    vip_booking_status_events: [],
    vip_agent_tasks: [],
  };

  const supabase = {
    from: (table: string) => {
      if (table === "venues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                  city_id: "11111111-1111-4111-8111-111111111111",
                  vip_booking_enabled: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "cities") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  timezone: "UTC",
                  service_day_cutoff_time: "06:00",
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_booking_requests") {
        return {
          insert: (payload: Record<string, unknown>) => {
            inserts.vip_booking_requests.push(payload);
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
                    status: "submitted",
                    created_at: "2026-02-27T12:00:00.000Z",
                    status_message: "Your VIP booking request has been sent to the venue booking desk.",
                  },
                  error: null,
                }),
              }),
            };
          },
        };
      }

      if (table === "vip_booking_status_events" || table === "vip_agent_tasks") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            inserts[table].push(payload);
            return { error: null };
          },
        };
      }

      throw new Error(`Unhandled table mock: ${table}`);
    },
  } as any;

  const result = await createVipBookingRequest(supabase, {
    venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
    booking_date: isoDateFromNow(1),
    arrival_time: "22:30",
    party_size: 6,
    customer_name: "Jane Doe",
    customer_email: "JANE@EXAMPLE.COM",
    customer_phone: "+1 (415) 555-0100",
    special_requests: "Birthday setup",
  });

  assert.equal(result.status, "submitted");
  assert.equal(result.booking_request_id, "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd");
  assert.equal(inserts.vip_booking_requests.length, 1);
  assert.equal(inserts.vip_booking_status_events.length, 1);
  assert.equal(inserts.vip_agent_tasks.length, 1);
});

test("createVipBookingRequest rejects booking dates outside same-day to +30 days", async () => {
  const supabase = {
    from: (table: string) => {
      if (table === "venues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                  city_id: "11111111-1111-4111-8111-111111111111",
                  vip_booking_enabled: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "cities") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  timezone: "UTC",
                  service_day_cutoff_time: "06:00",
                },
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table call: ${table}`);
    },
  } as any;

  await assert.rejects(
    async () =>
      createVipBookingRequest(supabase, {
        venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
        booking_date: "2999-01-01",
        arrival_time: "21:00",
        party_size: 4,
        customer_name: "Alice",
        customer_email: "alice@example.com",
        customer_phone: "+14155550101",
      }),
    (error) =>
      error instanceof NightlifeError &&
      error.code === "INVALID_BOOKING_REQUEST",
  );
});

test("createVipBookingRequest rejects venues without VIP booking support", async () => {
  const supabase = {
    from: (table: string) => {
      if (table === "venues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                  city_id: "11111111-1111-4111-8111-111111111111",
                  vip_booking_enabled: false,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table call: ${table}`);
    },
  } as any;

  await assert.rejects(
    async () =>
      createVipBookingRequest(supabase, {
        venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
        booking_date: isoDateFromNow(1),
        arrival_time: "21:00",
        party_size: 4,
        customer_name: "Alice",
        customer_email: "alice@example.com",
        customer_phone: "+14155550101",
      }),
    (error) =>
      error instanceof NightlifeError &&
      error.code === "INVALID_BOOKING_REQUEST" &&
      error.message.includes("not currently available"),
  );
});

test("getVipBookingStatus requires matching contact information", async () => {
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
                  updated_at: "2026-02-27T13:00:00.000Z",
                  status_message: "Still confirming with promoter.",
                  customer_email: "owner@example.com",
                  customer_phone: "+14155550101",
                },
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table call: ${table}`);
    },
  } as any;

  await assert.rejects(
    async () =>
      getVipBookingStatus(supabase, {
        booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
        customer_email: "wrong@example.com",
      }),
    (error) =>
      error instanceof NightlifeError &&
      error.code === "BOOKING_REQUEST_NOT_FOUND",
  );
});

test("isAllowedVipStatusTransition enforces phase 1 transition rules", () => {
  assert.equal(isAllowedVipStatusTransition("submitted", "in_review"), true);
  assert.equal(isAllowedVipStatusTransition("submitted", "confirmed"), true);
  assert.equal(isAllowedVipStatusTransition("in_review", "confirmed"), true);
  assert.equal(isAllowedVipStatusTransition("confirmed", "cancelled"), true);

  assert.equal(isAllowedVipStatusTransition("submitted", "submitted"), false);
  assert.equal(isAllowedVipStatusTransition("confirmed", "rejected"), false);
  assert.equal(isAllowedVipStatusTransition("rejected", "confirmed"), false);
  assert.equal(isAllowedVipStatusTransition("cancelled", "in_review"), false);
});

test("updateVipBookingStatus writes a status event row", async () => {
  const inserts: Record<string, unknown[]> = {
    vip_booking_status_events: [],
  };
  let settledTaskQueue = false;

  const supabase = {
    from: (table: string) => {
      if (table === "vip_booking_requests") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
                  status: "submitted",
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
                    status: "confirmed",
                    updated_at: "2026-02-27T13:30:00.000Z",
                    status_message: "Promoter confirmed your table.",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === "vip_booking_status_events") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            inserts.vip_booking_status_events.push(payload);
            return { error: null };
          },
        };
      }

      if (table === "vip_agent_tasks") {
        return {
          update: (payload: Record<string, unknown>) => {
            assert.equal(payload.status, "done");
            assert.equal(payload.last_error, null);

            return {
              eq: (column: string, value: string) => {
                assert.equal(column, "booking_request_id");
                assert.equal(value, "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd");

                return {
                  in: async (statusColumn: string, statuses: string[]) => {
                    assert.equal(statusColumn, "status");
                    assert.deepEqual(statuses, ["pending", "claimed"]);
                    settledTaskQueue = true;
                    return { error: null };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table call: ${table}`);
    },
  } as any;

  const updated = await updateVipBookingStatus(supabase, {
    booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
    to_status: "confirmed",
    actor_type: "agent",
    note: "Confirmed by promoter.",
    status_message: "Promoter confirmed your table.",
  });

  assert.equal(updated.status, "confirmed");
  assert.equal(settledTaskQueue, true);
  assert.equal(inserts.vip_booking_status_events.length, 1);
  assert.equal((inserts.vip_booking_status_events[0] as any).from_status, "submitted");
  assert.equal((inserts.vip_booking_status_events[0] as any).to_status, "confirmed");
});

test("getVipBookingStatus never exposes internal notes", async () => {
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
                  updated_at: "2026-02-27T13:00:00.000Z",
                  status_message: "Still confirming with promoter.",
                  customer_email: "owner@example.com",
                  customer_phone: "+14155550101",
                  agent_internal_note: "Do not expose this note",
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_booking_status_events") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: [
                    {
                      to_status: "submitted",
                      note: "Request submitted.",
                      created_at: "2026-02-27T12:00:00.000Z",
                    },
                    {
                      to_status: "in_review",
                      note: "Checking promoter availability.",
                      created_at: "2026-02-27T12:10:00.000Z",
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table call: ${table}`);
    },
  } as any;

  const status = await getVipBookingStatus(supabase, {
    booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
    customer_phone: "+1 415 555 0101",
  });

  assert.equal(status.status, "in_review");
  assert.equal(status.latest_note, "Checking promoter availability.");
  assert.equal(Object.prototype.hasOwnProperty.call(status, "agent_internal_note"), false);
});

test("claimNextVipAgentTask maps RPC response", async () => {
  const supabase = {
    rpc: async () => ({
      data: [
        {
          task_id: "a7a14ec4-a885-4678-8f2e-47b5f8c2959b",
          booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
          attempt_count: 2,
          booking_date: "2026-02-28",
          arrival_time: "22:00:00",
          party_size: 4,
          customer_name: "Jane",
          customer_email: "jane@example.com",
          customer_phone: "+14155550101",
          special_requests: null,
          current_status: "submitted",
        },
      ],
      error: null,
    }),
  } as any;

  const claimed = await claimNextVipAgentTask(supabase, "agent-1");
  assert.ok(claimed);
  assert.equal(claimed?.task_id, "a7a14ec4-a885-4678-8f2e-47b5f8c2959b");
  assert.equal(claimed?.attempt_count, 2);
});

test("listVipRequestsForAlerting returns due pending tasks", async () => {
  const supabase = {
    rpc: async (_fn: string, params: Record<string, unknown>) => {
      assert.equal(params.p_limit, 20);
      return {
        data: [
          {
            task_id: "a7a14ec4-a885-4678-8f2e-47b5f8c2959b",
            booking_request_id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
            booking_date: "2026-03-01",
            arrival_time: "22:00:00",
            party_size: 4,
            customer_name: "Jane",
            customer_email: "jane@example.com",
            customer_phone: "+14155550101",
            special_requests: "Birthday setup",
            venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
            venue_name: "Zouk",
            current_status: "submitted",
            request_created_at: "2026-02-28T11:00:00.000Z",
            first_alerted_at: null,
            last_alerted_at: null,
            alert_count: 0,
            escalated_at: null,
            should_escalate: false,
          },
          {
            task_id: "30146f0f-a736-48e3-a79f-d368f1331a6d",
            booking_request_id: "ec5de5a3-7d2e-4452-9241-ec73933df748",
            booking_date: "2026-03-01",
            arrival_time: "23:00:00",
            party_size: 2,
            customer_name: "Alex",
            customer_email: "alex@example.com",
            customer_phone: "+14155550102",
            special_requests: null,
            venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
            venue_name: "Zouk",
            current_status: "rejected",
            request_created_at: "2026-02-28T10:00:00.000Z",
            first_alerted_at: "2026-02-28T10:00:30.000Z",
            last_alerted_at: "2026-02-28T10:05:30.000Z",
            alert_count: 2,
            escalated_at: null,
            should_escalate: false,
          },
        ],
        error: null,
      };
    },
  } as any;

  const result = await listVipRequestsForAlerting(supabase, {});
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].venue_name, "Zouk");
  assert.equal(result.tasks[0].current_status, "submitted");
});

test("listVipReservations returns outstanding reservations with latest event and task context", async () => {
  const supabase = {
    from: (table: string) => {
      if (table === "vip_booking_requests") {
        return {
          select: () => ({
            in: (_column: string, values: string[]) => {
              assert.deepEqual(values, ["submitted", "in_review", "confirmed"]);
              return {
                order: () => ({
                  limit: async () => ({
                    data: [
                      {
                        id: "b0ef9e38-b9f5-4712-bfd5-4c5f3f1f16cd",
                        status: "submitted",
                        status_message: "Your VIP booking request has been sent to the venue booking desk.",
                        booking_date: "2026-03-01",
                        arrival_time: "22:30:00",
                        party_size: 4,
                        customer_name: "Jane",
                        customer_email: "jane@example.com",
                        customer_phone: "+14155550101",
                        special_requests: "Near DJ",
                        venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                        created_at: "2026-02-28T11:00:00.000Z",
                        updated_at: "2026-02-28T11:00:00.000Z",
                      },
                    ],
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
                    note: "VIP booking request sent to venue booking desk.",
                    created_at: "2026-02-28T11:00:01.000Z",
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
                    next_attempt_at: "2026-02-28T11:05:00.000Z",
                    claimed_by: null,
                    claimed_at: null,
                    alert_count: 1,
                    last_alerted_at: "2026-02-28T11:00:30.000Z",
                    updated_at: "2026-02-28T11:00:30.000Z",
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table call: ${table}`);
    },
  } as any;

  const result = await listVipReservations(supabase, {});
  assert.equal(result.count, 1);
  assert.equal(result.reservations[0].venue_name, "Zouk");
  assert.equal(result.reservations[0].latest_event_note, "VIP booking request sent to venue booking desk.");
  assert.equal(result.reservations[0].latest_task?.status, "pending");
});

test("listVipReservations rejects invalid status filters", async () => {
  await assert.rejects(
    async () =>
      listVipReservations({} as any, {
        statuses: ["invalid_status" as any],
      }),
    (error) =>
      error instanceof NightlifeError &&
      error.code === "INVALID_REQUEST",
  );
});

test("markVipRequestAlertSent maps retry update", async () => {
  const supabase = {
    rpc: async () => ({
      data: [
        {
          task_id: "a7a14ec4-a885-4678-8f2e-47b5f8c2959b",
          status: "pending",
          first_alerted_at: "2026-02-28T12:00:00.000Z",
          last_alerted_at: "2026-02-28T12:00:00.000Z",
          alert_count: 3,
          escalated_at: null,
          next_attempt_at: "2026-02-28T12:05:00.000Z",
        },
      ],
      error: null,
    }),
  } as any;

  const result = await markVipRequestAlertSent(supabase, {
    task_id: "a7a14ec4-a885-4678-8f2e-47b5f8c2959b",
    broadcast_count: 3,
    escalation: false,
  });

  assert.equal(result.status, "pending");
  assert.equal(result.alert_count, 3);
});

test("claimVipRequestAfterAck maps done claim payload", async () => {
  const supabase = {
    rpc: async () => ({
      data: [
        {
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
        },
      ],
      error: null,
    }),
  } as any;

  const result = await claimVipRequestAfterAck(supabase, {
    task_id: "a7a14ec4-a885-4678-8f2e-47b5f8c2959b",
    agent_id: "allen",
    claimed_by_session: "agent:allen:line:direct:U123",
    claimed_by_channel: "line",
    claimed_by_actor: "allen-line",
  });

  assert.equal(result.task_status, "done");
  assert.equal(result.booking_status, "in_review");
});

test("claimVipRequestAfterAck maps race loss to VIP_TASK_NOT_AVAILABLE", async () => {
  const supabase = {
    rpc: async () => ({
      data: null,
      error: { message: "VIP task not available for acknowledgement: id" },
    }),
  } as any;

  await assert.rejects(
    async () =>
      claimVipRequestAfterAck(supabase, {
        task_id: "a7a14ec4-a885-4678-8f2e-47b5f8c2959b",
        agent_id: "allen",
        claimed_by_session: "agent:allen:line:direct:U123",
        claimed_by_channel: "line",
        claimed_by_actor: "allen-line",
      }),
    (error) =>
      error instanceof NightlifeError &&
      error.code === "VIP_TASK_NOT_AVAILABLE",
  );
});
