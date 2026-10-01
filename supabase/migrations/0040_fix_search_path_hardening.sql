-- ============================================================================
-- 0040 — Fix missing search_path hardening on three helper functions
--
-- Found via Supabase's own security advisor (2026-10-01): now_melbourne, date_plus_one, and
-- date_minus_one were added across migrations 0033/0037/0039 without `set search_path to ''`,
-- unlike every other function in this schema. A mutable search_path on a SECURITY DEFINER-style
-- function is the classic vector for a search-path-hijack attack (a malicious schema earlier in
-- the path shadowing a built-in function/type) — these three are STABLE, not SECURITY DEFINER,
-- so the real exposure is low, but there's no reason not to match the same hardening as
-- everything else and remove the inconsistency.
-- ============================================================================

create or replace function sonario.now_melbourne(p_at timestamptz default null)
returns text
language sql stable set search_path to ''
as $$
  select to_char(coalesce(p_at, now()) at time zone 'Australia/Melbourne', 'YYYY-MM-DD"T"HH24:MI:SS');
$$;

create or replace function sonario.date_plus_one(p_date date)
returns date
language sql stable set search_path to ''
as $$
  select p_date + 1;
$$;

create or replace function sonario.date_minus_one(p_date date)
returns date
language sql stable set search_path to ''
as $$
  select p_date - 1;
$$;

-- ============================================================================
-- Verification
-- ============================================================================
select p.proname, p.proconfig
from pg_proc p
where p.pronamespace = 'sonario'::regnamespace
  and p.proname in ('now_melbourne', 'date_plus_one', 'date_minus_one');
-- expect: each row's proconfig includes 'search_path='
