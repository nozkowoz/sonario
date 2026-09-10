-- ============================================================================
-- A1 FOLLOW-UP.  READ-ONLY.  Run in the same SHARED project.
--
-- The first audit answered "what exists". These four questions are what the
-- answers raised, and each one changes a decision in SPLIT-PLAN.md:
--
--   1. Do the three legacy tables (notices, social_events, social_rsvps) hold
--      DATA? They are pre-rebuild leftovers that no migration recreates, so the
--      new project won't have them unless we deliberately add them back. Empty
--      means "just don't carry them". Non-empty means a decision.
--   2. Which two memberships are `super`, and is the Leave Test identity an
--      ORDINARY member? If that identity is secretly a super, every "verified
--      as a plain member" RLS result in this project's history is suspect.
--   3. Whose Storage buckets are `trip-photos` and `update-photos`? Neither
--      name sounds like Sonario or Page Turners.
--   4. What are the 24 tables in `public`? Page Turners needs a handful.
--
-- Nothing here writes. Paste back all four result sets.
-- ============================================================================

-- --- 1. Do the legacy tables hold anything? --------------------------------
select 'notices' as tbl, count(*) as rows from sonario.notices
union all select 'social_events', count(*) from sonario.social_events
union all select 'social_rsvps',  count(*) from sonario.social_rsvps
order by tbl;

-- --- 2. Who is who, and is Leave Test an ordinary member? ------------------
-- `is_anonymous` identifies the throwaway test identities; the seeded fakes are
-- the fixed f0000000-… UUIDs.
select p.display_name,
       coalesce(nullif(p.google_email, ''), '(none)') as email,
       m.status,
       m.role,
       case
         when p.id::text like 'f0000000-0000-0000-0000-%' then 'seeded fake'
         when u.is_anonymous then 'anonymous test identity'
         else 'real sign-in'
       end as kind
from sonario.profiles p
left join sonario.memberships m on m.profile_id = p.id
left join auth.users u on u.id = p.id
order by (m.role = 'super') desc, kind, p.display_name;

-- --- 3. Whose buckets are these? ------------------------------------------
select b.name as bucket,
       b.public,
       b.created_at::date as created,
       count(o.id) as objects,
       -- Cast INSIDE sum(): metadata->>'size' is text, so sum() has to receive a bigint. Casting
       -- the sum's result instead means calling sum(text), which has no such function.
       coalesce(pg_size_pretty(sum((o.metadata->>'size')::bigint)), '0 bytes') as total_size
from storage.buckets b
left join storage.objects o on o.bucket_id = b.id
group by b.name, b.public, b.created_at
order by b.name;

-- --- 4. What is actually in `public`? -------------------------------------
-- Page Turners' code references books, ratings and meetings. If the rest look
-- like a third app, this project is carrying more leftovers than assumed —
-- which is context for the quota argument, NOT something this plan touches.
select table_name,
       (select count(*) from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = t.table_name) as cols,
       (select count(*) from pg_policies pol
        where pol.schemaname = 'public' and pol.tablename = t.table_name) as policies
from information_schema.tables t
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
