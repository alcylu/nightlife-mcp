import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUsageRequestRouter } from "./usageRequests.js";
import { sendUsageNotification, startUsageNotificationWorker, usagePayloads, usageRequestSchema, type UsageDelivery } from "../services/usageRequests.js";

const config = { resendApiKey: "email-token", lineToken: "line-token", lineUserId: "owner-line", emailTo: "owner@example.com" };
const input = { request_id: "00000000-0000-4000-8000-000000000001", monthly_requests: 10000, website: "https://example.com", use_case: "Supporting my nightlife website" };

test("usage enquiry validates bounded inputs and fixes notification recipients on the server", () => {
  assert.ok(usageRequestSchema.safeParse(input).success);
  for (const invalid of [{ ...input, monthly_requests: -1 }, { ...input, monthly_requests: 1.5 }, { ...input, website: "javascript:alert(1)" }, { ...input, use_case: "short" }, { ...input, email: "forged@example.com" }, { ...input, to: "attacker" }]) assert.ok(!usageRequestSchema.safeParse(invalid).success);
  const payload = usagePayloads(input, "verified@example.com", config);
  assert.deepEqual(payload.email.to, ["owner@example.com"]);
  assert.equal(payload.email.reply_to, "verified@example.com");
  assert.equal(payload.line.to, "owner-line");
  assert.match(payload.email.text, /10,000 requests\/month/);
  assert.match(payload.email.text, /no quota increase or charge/);
});

test("request route rejects unconfirmed users, forged recipients, invalid inputs and quota spam", async () => {
  let confirmed = true, rpcData = "received", rpcArgs: any, flushes = 0;
  const db = { auth: { async getUser() { return { data: { user: { id: "verified-user", email: "verified@example.com", email_confirmed_at: confirmed ? "2026-10-15" : null } }, error: null }; } }, async rpc(_name: string, args: any) { rpcArgs = args; return { data: rpcData, error: null }; } } as unknown as SupabaseClient;
  const app = express(); app.use(express.json()); app.use(createUsageRequestRouter(db, config, async () => { flushes++; }));
  const server = app.listen(0,"127.0.0.1"); await new Promise<void>(r => server.once("listening",r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/usage-request`;
  async function send(body: unknown = input, auth = true) { return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer account-token" } : {}) }, body: JSON.stringify(body) }); }
  try {
    assert.equal((await send(input,false)).status,401);
    confirmed=false; assert.equal((await send()).status,401); confirmed=true;
    assert.equal((await send({ ...input, email: "spoof@example.com" })).status,400);
    assert.equal((await send()).status,202);
    assert.equal(rpcArgs.p_email,"verified@example.com"); assert.equal(rpcArgs.p_user_id,"verified-user"); assert.equal(flushes,1);
    rpcData="rate_limited"; assert.equal((await send()).status,429);
    rpcData="conflict"; assert.equal((await send()).status,409);
    rpcData="unexpected"; assert.equal((await send()).status,503);
  } finally { await new Promise<void>(r=>server.close(()=>r())); }
});

test("email and LINE use separate immutable deduplication keys; provider failures are not success", async () => {
  const seen: any[]=[];
  const fetcher = (async (url: unknown, options: any) => { seen.push({url,...options}); return new Response("{}",{status:200}); }) as typeof fetch;
  const delivery: UsageDelivery = { id: input.request_id, channel: "email", payload: { text: "Test" }, attempts: 1, created_at: new Date().toISOString() };
  await sendUsageNotification(delivery,config,fetcher);
  await sendUsageNotification({...delivery,channel:"line"},config,fetcher);
  assert.equal(seen[0].headers["Idempotency-Key"],`usage-request/${input.request_id}`);
  assert.equal(seen[1].headers["X-Line-Retry-Key"],input.request_id);
  assert.equal(seen[0].body,seen[1].body);
  await assert.rejects(sendUsageNotification(delivery,config,async()=>new Response("{}",{status:429})),/provider_http_429/);
  await assert.rejects(sendUsageNotification({...delivery,channel:"line"},config,async()=>new Response("{}",{status:409})),/provider_http_409/);
  await sendUsageNotification({...delivery,channel:"line"},config,async()=>new Response("{}",{status:409,headers:{"x-line-accepted-request-id":"accepted"}}));
});

test("worker persists channel failures instead of discarding saved requests", async () => {
  const updates:any[]=[];
  const db={ async rpc(){return {data:[{id:input.request_id,channel:"email",payload:{},attempts:1,created_at:new Date().toISOString()}],error:null};},from(){return {update(v:any){updates.push(v);return {async eq(){return {error:null};}};}};}} as unknown as SupabaseClient;
  const worker=startUsageNotificationWorker(db,{...config,resendApiKey:null});
  await new Promise(r=>setTimeout(r,10));worker.stop();
  assert.equal(updates.length,1);assert.equal(updates[0].state,"pending");assert.equal(updates[0].last_error,"channel_not_configured");
});
