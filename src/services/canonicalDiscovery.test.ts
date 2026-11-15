import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../config.js';
import { searchEvents, getEventDetails } from './events.js';

const canonical = '00000000-0000-4000-8000-000000000011';
const archived = '00000000-0000-4000-8000-000000000012';
const draft = '00000000-0000-4000-8000-000000000013';
function fixture(city: string, country: string) {
  const cityId = '00000000-0000-4000-8000-000000000020';
  const config = loadConfig({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline', DEFAULT_CITY: city, DEFAULT_COUNTRY_CODE: country });
  const roots = [
    { id: archived, merged_into_id: canonical, published: true, featured: true, heat_score: 100 },
    { id: draft, merged_into_id: null, published: false, featured: true, heat_score: 99 },
    { id: canonical, merged_into_id: null, published: true, featured: false, heat_score: 1 },
  ].map(row => ({ ...row, city_id: cityId, name_en: row.id, start_at: '2026-12-01T12:00:00Z', end_at: null, occurrence_days: [], venue: null }));
  const fetched: string[] = [];
  const client = createClient(config.supabaseUrl, 'offline', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)); fetched.push(url.pathname);
    const table = url.pathname.split('/').pop();
    let rows: Record<string, unknown>[] = table === 'cities' ? [{ id: cityId, slug: city, name_en: city, country_code: country, timezone: country === 'JP' ? 'Asia/Tokyo' : 'Europe/Amsterdam', service_day_cutoff_time: '06:00' }] : table === 'event_occurrences' ? roots.slice() : [];
    if (table === 'event_occurrences') {
      if (url.searchParams.get('published') === 'eq.true') rows = rows.filter(r => r.published === true);
      if (url.searchParams.get('merged_into_id') === 'is.null') rows = rows.filter(r => r.merged_into_id === null);
      const id = url.searchParams.get('id'); if (id?.startsWith('eq.')) rows = rows.filter(r => r.id === id.slice(3));
      const order = url.searchParams.get('order') || '';
      if (order.includes('heat_score.desc')) rows.sort((a,b) => Number(b.heat_score) - Number(a.heat_score));
      else if (order.includes('featured.desc')) rows.sort((a,b) => Number(b.featured) - Number(a.featured));
      const offset = Number(url.searchParams.get('offset') || 0); const limit = Number(url.searchParams.get('limit') || rows.length); rows = rows.slice(offset, offset + limit);
    }
    const headers = new Headers(init?.headers); const single = headers.get('accept')?.includes('application/vnd.pgrst.object+json');
    return new Response(JSON.stringify(single ? rows[0] ?? null : rows), {status: 200, headers: {'Content-Type': 'application/json'}});
  } } });
  return { client, config, fetched };
}
for (const [city,country] of [['tokyo','JP'],['amsterdam','NL']]) {
  for (const sort_by of ['date','heat'] as const) test(`${city} ${sort_by} browse excludes published archives before its one-result page`, async () => {
    const f = fixture(city!,country!); const result = await searchEvents(f.client, f.config, {city,sort_by,limit:1});
    assert.deepEqual(result.events.map(e => e.event_id),[canonical]);
  });
  test(`${city} retained published archive has no public event detail`, async () => {
    const f = fixture(city!,country!); assert.equal(await getEventDetails(f.client,f.config,archived),null);
    assert.equal(f.fetched.some(p => /ticket|guest/.test(p)),false, 'archive cannot reach ticket or guest detail reads');
  });
}
