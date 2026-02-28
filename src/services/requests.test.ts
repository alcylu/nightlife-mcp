import test from "node:test";
import assert from "node:assert/strict";
import { NightlifeError } from "../errors.js";
import { logUnmetRequest } from "./requests.js";

test("logUnmetRequest validates raw_query", async () => {
  await assert.rejects(
    async () =>
      logUnmetRequest({} as any, {
        raw_query: "   ",
      }),
    (error) => error instanceof NightlifeError && error.code === "INVALID_REQUEST",
  );
});

test("logUnmetRequest writes normalized payload", async () => {
  let inserted: Record<string, unknown> | null = null;
  const supabase = {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        inserted = payload;
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                status: "open",
                created_at: "2026-02-26T10:00:00.000Z",
              },
              error: null,
            }),
          }),
        };
      },
    }),
  } as any;

  const result = await logUnmetRequest(supabase, {
    channel: "Discord",
    language: "EN-US",
    city: "Tokyo",
    raw_query: "Find underground psytrance boat party next Tuesday",
    intent: "missing_inventory",
    suggested_filters: { genre: "psytrance" },
    user_hash: "user:123",
  });

  assert.equal(result.request_id, "d290f1ee-6c54-4b01-90e6-d701748f0851");
  assert.equal(result.status, "open");
  assert.equal((inserted as any).channel, "discord");
  assert.equal((inserted as any).language, "en-us");
  assert.equal((inserted as any).city, "tokyo");
});
