-- supabase/migrations/20260312_fuzzy_search.sql
-- Transactional migration: extensions + f_unaccent wrapper + search_venues_fuzzy RPC
-- Phase 10 (DB-01, DB-02, DB-04) — fuzzy venue search infrastructure
--
-- Apply FIRST, before 20260312_fuzzy_search_index.sql
-- f_unaccent must exist before the GIN index references it.

-- 1. Enable extensions (idempotent — safe to run multiple times)
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. IMMUTABLE wrapper around unaccent()
--    Built-in unaccent() is STABLE — PostgreSQL forbids STABLE functions in index
--    expressions. The schema-qualified dictionary form below satisfies the IMMUTABLE
--    contract and is required before any GIN index on f_unaccent(lower(name_en)).
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$
  SELECT public.unaccent('public.unaccent', $1)
$$;

-- 3. Fuzzy venue search RPC scoped by city (DB-04)
--    Uses word_similarity (NOT similarity) — better for partial name matches;
--    short queries like "celavi" score higher against "ce la vi".
--    Three-arm WHERE clause:
--      a) trigram similarity — catches typos and reorderings
--      b) ILIKE containment on normalized name — catches substring matches
--      c) space-stripped ILIKE — "celavi" matches "ce la vi" after space removal
--    CRITICAL: expression f_unaccent(lower(v.name_en)) must match the GIN index
--    expression exactly (same function nesting order) for the planner to use the index.
CREATE OR REPLACE FUNCTION public.search_venues_fuzzy(
  p_city_id   uuid,
  p_query     text,    -- pre-normalized: lowercased, diacritics stripped, spaces removed
  p_threshold float    DEFAULT 0.15,
  p_limit     int      DEFAULT 200
)
RETURNS SETOF public.venues
LANGUAGE sql STABLE AS
$$
  SELECT v.*
  FROM public.venues v
  WHERE v.city_id = p_city_id
    AND (
      word_similarity(p_query, f_unaccent(lower(v.name_en))) > p_threshold
      OR f_unaccent(lower(v.name_en)) ILIKE '%' || p_query || '%'
      OR replace(f_unaccent(lower(v.name_en)), ' ', '') ILIKE '%' || p_query || '%'
    )
  ORDER BY word_similarity(p_query, f_unaccent(lower(v.name_en))) DESC
  LIMIT p_limit;
$$;
