import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSiteAnalyticsRouter, siteEventSchema } from "./siteAnalytics.js";
import { loadConfig } from "../config.js";

const event = {visit:"00000000-0000-4000-8000-000000000001",event:"page_view",page:"home",source:"search",plan:"none"};
test("analytics requires an explicit valid opt-in",()=>{
  const env={SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"fixture"};
  assert.equal(loadConfig(env).siteAnalyticsEnabled,false);
  assert.equal(loadConfig({...env,MCP_ENABLE_SITE_ANALYTICS:"false"}).siteAnalyticsEnabled,false);
  assert.equal(loadConfig({...env,MCP_ENABLE_SITE_ANALYTICS:"true"}).siteAnalyticsEnabled,true);
  assert.throws(()=>loadConfig({...env,MCP_ENABLE_SITE_ANALYTICS:"yes"}));
});
test("disabled analytics has no HTTP endpoint or database side effects",async()=>{
  let calls=0;
  const db={async rpc(){calls++;throw new Error("Disabled collector must not write");}} as unknown as SupabaseClient;
  for(const value of [undefined,"false"]){
    const config=loadConfig({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"fixture",MCP_ENABLE_SITE_ANALYTICS:value});
    const app=express();app.use(express.json());app.use("/site-analytics",createSiteAnalyticsRouter(db,config.developerSiteUrl,config.siteAnalyticsEnabled));
    const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/site-analytics/event`;
    try{
      for(const method of ["POST","OPTIONS"]){
        const response=await fetch(url,{method,headers:{"Content-Type":"application/json",Origin:config.developerSiteUrl,"User-Agent":"Mozilla/5.0"},...(method==="POST"?{body:JSON.stringify(event)}:{})});
        assert.equal(response.status,404);assert.equal(response.headers.get("access-control-allow-origin"),null);
      }
    } finally {await new Promise<void>(r=>server.close(()=>r()));}
  }
  assert.equal(calls,0);
});
test("analytics allowlist rejects personal data, arbitrary labels and URLs",()=>{
  assert.ok(siteEventSchema.safeParse(event).success);
  for(const body of [{...event,email:"private@example.com"},{...event,page:"/signup?token=secret"},{...event,source:"private@example.com"},{...event,visit:"user-id"},{...event,event:"paid"}]) assert.ok(!siteEventSchema.safeParse(body).success);
});
test("analytics enforces origin, opt-out, bot filtering, rate caps and fail-closed storage",async()=>{
  const recorded: unknown[]=[]; let fail=false;
  const db={async rpc(name:string,payload:unknown){assert.equal(name,"record_mcp_site_event");recorded.push(payload);return {error:fail?new Error("unavailable"):null};}} as unknown as SupabaseClient;
  const app=express();app.use(express.json({limit:"2kb"}));app.use("/analytics",createSiteAnalyticsRouter(db,"https://nightlife.dev",true));
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/analytics/event`;
  const send=(body:unknown=event,extra:Record<string,string>={})=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://nightlife.dev","User-Agent":"Mozilla/5.0",...extra},body:JSON.stringify(body)});
  try{
    assert.equal((await send(event,{Origin:"https://evil.example"})).status,403);
    assert.equal((await send(event,{DNT:"1"})).status,204);
    assert.equal((await send(event,{"Sec-GPC":"1"})).status,204);
    assert.equal((await send(event,{"User-Agent":"HeadlessChrome"})).status,204);
    assert.equal(recorded.length,0);
    assert.equal((await send({...event,password:"never"})).status,400);
    assert.equal((await send()).status,204);
    assert.deepEqual(recorded[0],{p_visit:event.visit,p_event:"page_view",p_page:"home",p_source:"search",p_plan:"none"});
    fail=true;assert.equal((await send()).status,503);fail=false;
    for(let i=0;i<58;i++)assert.equal((await send()).status,204);
    assert.equal((await send()).status,429);
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
});
