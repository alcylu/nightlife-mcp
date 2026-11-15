import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { searchEvents, getEventDetails } from "./events.js";
import { searchVenues, getVenueInfo } from "./venues.js";
import { searchPerformers, getPerformerInfo } from "./performers.js";
import { getRecommendations } from "./recommendations.js";
import { getVipPricing } from "./vipPricing.js";
import { getVipTableAvailability } from "./vipTables.js";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const city = { id:id(1),slug:"tokyo",name_en:"Tokyo",timezone:"Asia/Tokyo",service_day_cutoff_time:"06:00",country_code:"JP" };
const venue = { id:id(2),city_id:city.id,name:"Fixture Club",name_en:"Fixture Club",vip_booking_enabled:true,vip_default_min_spend:null,vip_default_currency:null };
const artist = { id:id(3),name:"Fixture Artist",type:"DJ",slug:"fixture-artist" };
const date = new Date(Date.now()+2*86400000).toISOString().slice(0,10);
const config = { defaultCity:"tokyo",defaultCountryCode:"JP",nightlifeBaseUrl:"https://nightlifetokyo.com",topLevelCities:["tokyo"],mcpEnableRecommendations:true } as AppConfig;
type Row = Record<string, any>;
const canonical: Row = { id:id(10),city_id:city.id,venue_id:venue.id,name_en:"Canonical night",start_at:date+"T13:00:00Z",end_at:null,published:true,merged_into_id:null,featured:false,venue,occurrence_days:[] };
const archive: Row = { ...canonical,id:id(11),name_en:"Archived duplicate",start_at:date+"T12:00:00Z",merged_into_id:canonical.id };
const draft: Row = { ...canonical,id:id(12),name_en:"Unpublished draft",published:false };

// Real Supabase client and URL serialization; the only transport is this
// in-memory REST fixture. No API keys, environment files or network calls.
function fixture(events: Row[] = []) {
  const eventReads: URL[] = [];
  const requests: URL[] = [];
  const tables: Record<string, Row[]> = {
    cities:[city],venues:[venue],performers:[artist],event_occurrences:events,
    genres:[{id:id(4),name_en:"House"}],
    event_genres:[{event_id:canonical.id,genre_id:id(4)}],
    event_stages:[{id:id(5),event_id:canonical.id,custom_name:"Main",venue_stage:null,event_timetables:[]}],
    event_timetables:[{id:id(6),event_stage_id:id(5),performer_id:artist.id,start_time:null,end_time:null}],
    venue_operating_hours:Array.from({length:7},(_,day_of_week)=>({venue_id:venue.id,day_of_week,is_enabled:false})),
  };
  const client=createClient("https://owned-fixture.invalid","offline-fixture",{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:async (input, init) => {
      const url=new URL(String(input));requests.push(url);
      assert.equal(url.origin,"https://owned-fixture.invalid");
      const table=url.pathname.split("/").at(-1)!;
      if (url.pathname.includes("/rpc/")) {
        const value=table==="expand_genre_ids"?[id(4)]:table==="search_venues_fuzzy"?[{venue_id:venue.id,id:venue.id}]:[];
        return new Response(JSON.stringify(value),{headers:{"Content-Type":"application/json"}});
      }
      assert.equal(init?.method ?? "GET","GET","Discovery fixture must remain read-only");
      if(table==="event_occurrences")eventReads.push(url);
      let rows=[...(tables[table]??[])];
      if(table==="venues"&&url.searchParams.get("select")?.includes("venue_operating_hours"))rows=[];
      for(const [column,filter]of url.searchParams){
        if(["select","order","offset","limit","or"].includes(column))continue;
        if(filter.startsWith("eq."))rows=rows.filter(row=>String(row[column])===filter.slice(3));
        else if(filter==="is.null")rows=rows.filter(row=>row[column]==null);
        else if(filter==="not.is.null")rows=rows.filter(row=>row[column]!=null);
        else if(filter.startsWith("gte."))rows=rows.filter(row=>String(row[column])>=filter.slice(4));
        else if(filter.startsWith("lt."))rows=rows.filter(row=>String(row[column])<filter.slice(3));
        else if(filter.startsWith("in.(")){const ids=filter.slice(4,-1).split(",");rows=rows.filter(row=>ids.includes(String(row[column])));}
      }
      // Filter before ordering/range, just as PostgREST does. An archived first
      // result must not consume the caller's only page slot.
      if(url.searchParams.get("order")?.includes("start_at"))rows.sort((a,b)=>String(a.start_at).localeCompare(String(b.start_at)));
      const total=rows.length;const offset=Number(url.searchParams.get("offset")??0);
      rows=rows.slice(offset,url.searchParams.has("limit")?offset+Number(url.searchParams.get("limit")):undefined);
      const headers=new Headers(init?.headers);
      const single=headers.get("Accept")?.includes("vnd.pgrst.object+json");
      return new Response(JSON.stringify(single?rows[0]??null:rows),{headers:{"Content-Type":"application/json","Content-Range":`0-${Math.max(0,rows.length-1)}/${total}`}});
    }},
  });
  return {client,eventReads,requests};
}

function assertCanonicalReads(reads:URL[],minimum=1){
  assert.ok(reads.length>=minimum,"Actual occurrence read must execute");
  for(const url of reads){
    assert.equal(url.searchParams.get("published"),"eq.true");
    assert.equal(url.searchParams.get("merged_into_id"),"is.null",url.pathname+" must filter canonical roots in the database");
  }
}

test("event search excludes a published archive before pagination and preserves the live result",async()=>{
  const f=fixture([archive,canonical,draft]);
  const result=await searchEvents(f.client,config,{city:"tokyo",date,limit:1});
  assert.deepEqual(result.events.map(row=>row.event_id),[canonical.id]);
  assertCanonicalReads(f.eventReads);
});

test("direct event detail does not expose a published merged ID or silently alias a separate record",async()=>{
  const f=fixture([archive,canonical,draft]);
  assert.equal(await getEventDetails(f.client,config,archive.id),null);
  assert.equal(await getEventDetails(f.client,config,draft.id),null);
  const live=await getEventDetails(f.client,config,canonical.id);
  assert.equal(live?.event_id,canonical.id);
  assertCanonicalReads(f.eventReads,3);
});

test("all discovery paths serialize canonical filtering, including genre batches and fuzzy venues",async()=>{
  const calls:Array<[string,(f:ReturnType<typeof fixture>)=>Promise<unknown>,number,Row[]?]>=[
    ["genre-filtered event batch",f=>searchEvents(f.client,config,{city:"tokyo",date,genre:id(4)}),1],
    ["venue search and fuzzy fallback",f=>searchVenues(f.client,config,{city:"tokyo",date,query:"Fixture Clb"}),2,[canonical]],
    ["venue detail",f=>getVenueInfo(f.client,config,venue.id),1],
    ["performer search",f=>searchPerformers(f.client,config,{city:"tokyo",date}),1],
    ["performer detail",f=>getPerformerInfo(f.client,config,artist.id),1],
    ["recommendations",f=>getRecommendations(f.client,config,{city:"tokyo",date}),1],
    ["VIP open-date snapshot",f=>getVipTableAvailability(f.client,{venue_id:venue.id,booking_date_from:date,booking_date_to:date}),1],
    ["VIP pricing event context",f=>getVipPricing(f.client,{venue_id:venue.id,date}),1],
  ];
  for(const [name,call,minimum,events]of calls){
    const f=fixture(events);await call(f);
    assert.ok(f.eventReads.length>=minimum,name+": query branch must actually execute: "+f.requests.map(u=>u.pathname+"?"+u.searchParams.toString()).join("; "));
    assertCanonicalReads(f.eventReads,minimum);
  }
});


test("a published archive cannot supply VIP open-day or busy-night context; the live occurrence still can",async()=>{
  for(const [events,open]of [[ [archive],false ],[ [canonical],true ]]as const){
    const f=fixture([...events]);
    const pricing=await getVipPricing(f.client,{venue_id:venue.id,date});
    assert.equal(pricing.venue_open,open);
    assert.equal(pricing.event_name,open?canonical.name_en:null);
    const availability=await getVipTableAvailability(f.client,{venue_id:venue.id,booking_date_from:date,booking_date_to:date});
    assert.equal(availability.days[0].venue_open,open);
    assertCanonicalReads(f.eventReads,2);
  }
});
