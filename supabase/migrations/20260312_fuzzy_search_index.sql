-- supabase/migrations/20260312_fuzzy_search_index.sql
-- NON-TRANSACTIONAL migration: GIN trigram index on venue name_en (Phase 10, DB-03)
--
-- IMPORTANT: Run this OUTSIDE a transaction block.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block (PostgreSQL restriction).
-- Options:
--   - Run directly in the Supabase SQL editor (no transaction wrapper by default)
--   - Run via psql: \set AUTOCOMMIT on  — then execute this file
-- Do NOT run via `supabase db push` without splitting the transaction.
--
-- Apply AFTER 20260312_fuzzy_search.sql — f_unaccent must exist before this index.

-- 4. GIN trigram index on normalized venue name_en (DB-03)
--    Expression f_unaccent(lower(name_en)) MUST match the RPC WHERE clause exactly.
--    If the order differs (e.g. lower(f_unaccent(...))) the index will not be used.
--    CONCURRENTLY: builds without locking the table — safe on shared DB with nightlife-tokyo-next.
CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_name_en_fuzzy
  ON public.venues
  USING GIN (f_unaccent(lower(name_en)) gin_trgm_ops);
