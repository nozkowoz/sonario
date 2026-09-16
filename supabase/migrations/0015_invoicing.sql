-- ============================================================================
-- 0015 — Invoicing v1: schema, tamper-proof invoice numbering, atomic run creation
--
-- Nina, 2026-09-15 through 2026-09-17, across several rounds of review. Summary of what's here
-- and why, so this reads standalone later:
--
--  - invoice_settings: singleton row (id is forced to 1 — see the check constraint), currently
--    just the per-term fee. Editable by a super via a plain update.
--
--  - invoice_runs: one row per "Create term invoices" action. The batch itself is a first-class
--    object rather than reconstructed from invoice timestamps, per Nina's explicit ask.
--
--  - invoices: one row per member per run. amount_cents, member_name and member_email are
--    SNAPSHOTTED at generation time, never looked up live — a historical invoice must read exactly
--    as issued even if the standard fee changes later. member_name/member_email specifically also
--    guard against a subtler problem: profiles.id cascades from auth.users(id), so a full account
--    deletion (rare, but real — e.g. someone revokes Google account access) would otherwise strand
--    a past invoice with no name/email to render if its PDF is ever regenerated. Snapshotting
--    means a historical invoice's PDF stays regenerable forever, independent of the profile.
--
--  - Invoice numbers come from a real Postgres sequence (invoice_number_seq), never a client-side
--    max()+1. The sequence is explicitly UNINITIALISED until a super runs
--    initialize_invoice_numbering() below — this table's mere existence must never be enough to
--    issue a number, and create_invoice_run() refuses to run at all until that's done. Once set,
--    it can never be changed again through any path this schema exposes, enforced by a trigger on
--    invoice_settings itself (not just by initialize_invoice_numbering() refusing a second call —
--    a raw client UPDATE attempting to reset numbering_initialized_at back to null is blocked at
--    the table level too). Nothing but the two security definer functions below may ever call
--    nextval()/setval() on the sequence — no USAGE grant to anon/authenticated at all.
--
--  - Generation (a term's whole batch — the run row, every selected member's invoice row, their
--    allocated numbers) happens in ONE transaction inside create_invoice_run(), not sequential
--    client inserts. A partial failure (e.g. a genuine duplicate slipping past the Preview step's
--    warning) rolls back the whole run — no half-created batch. Note Postgres sequences are NOT
--    transactional: a rolled-back run still permanently consumes the numbers it allocated before
--    failing. That's expected and fine (gaps in a numbering sequence are normal accounting
--    practice; duplicates or out-of-order numbers are the thing that actually matters).
--
--  - unique(term_id, profile_id) on invoices: at most one NORMAL invoice per member per term,
--    enforced by the database. Deliberately no void/reissue path yet — Nina: "if we later need
--    corrected/reissued invoices, we'll design an explicit void/reissue flow rather than allowing
--    silent duplicates."
--
--  - due_date is the one field a super can change after a row exists (the eventual Admin > a
--    member's invoice > Change due date action — this migration only adds the column + the
--    trigger guarding it, not that screen). invoice_number/invoice_run_id/term_id/profile_id/
--    member_name/member_email/amount_cents/invoice_date are immutable once a row exists, enforced
--    by enforce_invoice_immutability() below — not just app convention. due_date_updated_at/by are
--    server-stamped by that same trigger whenever due_date actually changes; deliberately no
--    "reason" column (Nina: "we don't need to store sensitive context about why").
--
--  - No member-facing access yet, deliberately (Nina: wants it eventually, not this stage). Every
--    policy here is super-only. See the HOOK FOR LATER comment near the bottom for what a future
--    own-row read policy would need — nothing here should need restructuring to add it.
--
--  - No Realtime — this is Admin-only tooling, not something needing live cross-client sync the
--    way check-ins does. Same "deliberately excluded" precedent as song_lyrics (migration 0011).
--
--  - Deliberately NOT in this migration: anything about emailing invoices. If/when the minimal
--    "Send invoice email" action gets built, it needs exactly one small additive column
--    (something like invoices.email_sent_at) — a separate migration, not blocking this one.
-- ============================================================================

create table if not exists sonario.invoice_settings (
  id integer primary key check (id = 1),
  fee_cents integer not null check (fee_cents > 0),
  numbering_initialized_at timestamptz,
  numbering_initialized_by uuid references sonario.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references sonario.profiles(id)
);

-- Seed the single row so the table is never empty. $220 — today's real fee — is just the starting
-- value; change it via a normal update once this is live, same as any other setting.
insert into sonario.invoice_settings (id, fee_cents)
values (1, 22000)
on conflict (id) do nothing;

create table if not exists sonario.invoice_runs (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references sonario.terms(id),
  invoice_date date not null,
  due_date date not null,
  fee_cents integer not null check (fee_cents > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references sonario.profiles(id)
);

create table if not exists sonario.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_run_id uuid not null references sonario.invoice_runs(id),
  invoice_number integer not null unique,
  term_id uuid not null references sonario.terms(id),
  profile_id uuid not null references sonario.profiles(id),
  member_name text not null,
  member_email text not null,
  amount_cents integer not null check (amount_cents > 0),
  invoice_date date not null,
  due_date date not null,
  due_date_updated_at timestamptz,
  due_date_updated_by uuid references sonario.profiles(id),
  created_at timestamptz not null default now(),
  created_by uuid not null references sonario.profiles(id),
  unique (term_id, profile_id)
);

create index if not exists invoices_invoice_run_id_idx on sonario.invoices(invoice_run_id);
create index if not exists invoices_term_id_idx on sonario.invoices(term_id);
create index if not exists invoices_profile_id_idx on sonario.invoices(profile_id);

-- The sequence itself. No starting value set here — its position is meaningless until
-- initialize_invoice_numbering() runs, and create_invoice_run() refuses to touch it before then.
create sequence if not exists sonario.invoice_number_seq;

drop trigger if exists invoice_settings_set_updated_at on sonario.invoice_settings;
create trigger invoice_settings_set_updated_at before update on sonario.invoice_settings
  for each row execute function sonario.set_updated_at();

-- ============================================================================
-- Numbering lock — once numbering_initialized_at is set, NOTHING can change it again, regardless
-- of write path. This is what makes "only works once" a database guarantee rather than an app
-- convention: even a raw client UPDATE attempting to null it back out (to re-run
-- initialize_invoice_numbering()) is rejected here.
-- ============================================================================
create or replace function sonario.enforce_invoice_settings_numbering_lock()
returns trigger as $$
begin
  if old.numbering_initialized_at is not null and (
    new.numbering_initialized_at is distinct from old.numbering_initialized_at
    or new.numbering_initialized_by is distinct from old.numbering_initialized_by
  ) then
    raise exception 'Invoice numbering has already been set up and cannot be changed.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = '';

revoke execute on function sonario.enforce_invoice_settings_numbering_lock() from public;

drop trigger if exists invoice_settings_lock_numbering on sonario.invoice_settings;
create trigger invoice_settings_lock_numbering
  before update on sonario.invoice_settings
  for each row execute function sonario.enforce_invoice_settings_numbering_lock();

-- ============================================================================
-- Invoice immutability — everything except due_date is frozen once a row exists. due_date changes
-- auto-stamp who/when; every other field changing at all is rejected outright.
-- ============================================================================
create or replace function sonario.enforce_invoice_immutability()
returns trigger as $$
begin
  if new.invoice_number is distinct from old.invoice_number
    or new.invoice_run_id is distinct from old.invoice_run_id
    or new.term_id is distinct from old.term_id
    or new.profile_id is distinct from old.profile_id
    or new.member_name is distinct from old.member_name
    or new.member_email is distinct from old.member_email
    or new.amount_cents is distinct from old.amount_cents
    or new.invoice_date is distinct from old.invoice_date
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by
  then
    raise exception 'Only an invoice''s due date can be changed once it has been issued.';
  end if;

  if new.due_date is distinct from old.due_date then
    new.due_date_updated_at = now();
    new.due_date_updated_by = auth.uid();
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = '';

revoke execute on function sonario.enforce_invoice_immutability() from public;

drop trigger if exists invoices_enforce_immutability on sonario.invoices;
create trigger invoices_enforce_immutability
  before update on sonario.invoices
  for each row execute function sonario.enforce_invoice_immutability();

-- ============================================================================
-- initialize_invoice_numbering() — the one-time setup action. "Next invoice number to issue" per
-- Nina's preferred wording. Guarded four ways: super-only, refuses if already initialised, refuses
-- if any invoice already exists (belt-and-braces alongside the lock trigger above), refuses a
-- non-positive number. is_called = false on the setval means the very next nextval() call returns
-- p_next_number itself, not p_next_number + 1.
-- ============================================================================
create or replace function sonario.initialize_invoice_numbering(p_next_number integer)
returns sonario.invoice_settings as $$
declare
  v_settings sonario.invoice_settings;
begin
  if not sonario.is_super() then
    raise exception 'Only a super user can set up invoice numbering.';
  end if;

  select * into v_settings from sonario.invoice_settings where id = 1;

  if v_settings.numbering_initialized_at is not null then
    raise exception 'Invoice numbering has already been set up and cannot be changed.';
  end if;

  if exists (select 1 from sonario.invoices) then
    raise exception 'Invoices already exist; numbering cannot be initialised through this action.';
  end if;

  if p_next_number < 1 then
    raise exception 'Next invoice number must be a positive number.';
  end if;

  perform setval('sonario.invoice_number_seq', p_next_number, false);

  update sonario.invoice_settings
  set numbering_initialized_at = now(), numbering_initialized_by = auth.uid()
  where id = 1
  returning * into v_settings;

  return v_settings;
end;
$$ language plpgsql security definer set search_path = '';

revoke execute on function sonario.initialize_invoice_numbering(integer) from public;
grant execute on function sonario.initialize_invoice_numbering(integer) to authenticated;

-- ============================================================================
-- create_invoice_run() — the whole batch, atomically. p_profile_ids is the admin's already-
-- reviewed selection from the Preview step (all active members preselected, any deselected by
-- hand) — this function trusts that list rather than re-deriving "every active member" itself, so
-- a deliberate exclusion is respected exactly. Refuses outright if numbering isn't set up yet.
-- ============================================================================
create or replace function sonario.create_invoice_run(
  p_term_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_fee_cents integer,
  p_profile_ids uuid[]
)
returns sonario.invoice_runs as $$
declare
  v_run sonario.invoice_runs;
  v_profile_id uuid;
  v_display_name text;
  v_email text;
begin
  if not sonario.is_super() then
    raise exception 'Only a super user can generate invoices.';
  end if;

  if (select numbering_initialized_at from sonario.invoice_settings where id = 1) is null then
    raise exception 'Invoice numbering has not been set up yet. Finish invoicing setup first.';
  end if;

  if p_fee_cents <= 0 then
    raise exception 'Fee must be a positive amount.';
  end if;

  if p_profile_ids is null or array_length(p_profile_ids, 1) is null then
    raise exception 'Select at least one member to invoice.';
  end if;

  insert into sonario.invoice_runs (term_id, invoice_date, due_date, fee_cents, created_by)
  values (p_term_id, p_invoice_date, p_due_date, p_fee_cents, auth.uid())
  returning * into v_run;

  foreach v_profile_id in array p_profile_ids
  loop
    select display_name, google_email into v_display_name, v_email
    from sonario.profiles where id = v_profile_id;

    if v_display_name is null then
      raise exception 'Member % not found.', v_profile_id;
    end if;

    insert into sonario.invoices (
      invoice_run_id, invoice_number, term_id, profile_id, member_name, member_email,
      amount_cents, invoice_date, due_date, created_by
    ) values (
      v_run.id, nextval('sonario.invoice_number_seq'), p_term_id, v_profile_id,
      v_display_name, v_email, p_fee_cents, p_invoice_date, p_due_date, auth.uid()
    );
  end loop;

  return v_run;
end;
$$ language plpgsql security definer set search_path = '';

revoke execute on function sonario.create_invoice_run(uuid, date, date, integer, uuid[]) from public;
grant execute on function sonario.create_invoice_run(uuid, date, date, integer, uuid[]) to authenticated;

-- ============================================================================
-- RLS. Every table super-only. Deliberately no INSERT policy on invoice_runs or invoices at all
-- (rows are only ever created via create_invoice_run(), a security definer function that bypasses
-- RLS the same controlled way member_directory() and handle_new_auth_user() already do elsewhere
-- in this schema) — a super's own client can never insert one directly, even by accident. No
-- DELETE policy on invoices ever (an issued invoice is never deleted; void/reissue is future work,
-- see the migration header). invoice_runs has no UPDATE policy either — the run itself is a fixed
-- historical record; only an individual invoice's due_date flexes.
-- ============================================================================
alter table sonario.invoice_settings enable row level security;
alter table sonario.invoice_runs enable row level security;
alter table sonario.invoices enable row level security;

drop policy if exists "super reads invoice settings" on sonario.invoice_settings;
create policy "super reads invoice settings" on sonario.invoice_settings
  for select using (sonario.is_super());
drop policy if exists "super updates invoice settings" on sonario.invoice_settings;
create policy "super updates invoice settings" on sonario.invoice_settings
  for update using (sonario.is_super()) with check (sonario.is_super());

drop policy if exists "super reads invoice runs" on sonario.invoice_runs;
create policy "super reads invoice runs" on sonario.invoice_runs
  for select using (sonario.is_super());

drop policy if exists "super reads invoices" on sonario.invoices;
create policy "super reads invoices" on sonario.invoices
  for select using (sonario.is_super());
drop policy if exists "super updates invoice due date" on sonario.invoices;
create policy "super updates invoice due date" on sonario.invoices
  for update using (sonario.is_super()) with check (sonario.is_super());

-- Table-level grants, deliberately narrower than this schema's usual "grant all" belt-and-braces
-- (see 0008's note on why that pattern normally exists) — here the absence of insert/delete
-- privileges for invoice_runs/invoices is itself part of the "only the function can write"
-- guarantee, a second backstop below RLS rather than a redundant grant alongside it.
grant select, update on sonario.invoice_settings to authenticated;
grant select on sonario.invoice_runs to authenticated;
grant select, update on sonario.invoices to authenticated;

-- No usage/select grant on invoice_number_seq to anon/authenticated at all — only the two security
-- definer functions above (running as their owner) may ever call nextval()/setval() on it.

-- HOOK FOR LATER, do not build now: a future member-facing invoice view just needs one additional
-- SELECT policy on invoices, `profile_id = auth.uid() or sonario.is_super()`, same own-row-or-super
-- shape as checkins/rehearsal_absences/away_dates elsewhere in this schema. Nothing above needs
-- restructuring to add it.

-- ============================================================================
-- Verification — run after applying. Expect every `actual` to equal its `expected`.
-- ============================================================================
select 'invoice_settings seeded' as check_name, '1' as expected,
  (select count(*)::text from sonario.invoice_settings where id = 1) as actual
union all
select 'numbering starts uninitialised', '0',
  (select count(*)::text from sonario.invoice_settings where id = 1 and numbering_initialized_at is not null)
union all
select 'tables exist (runs, invoices)', '2',
  (select count(*)::text from information_schema.tables
   where table_schema = 'sonario' and table_name in ('invoice_runs', 'invoices'))
union all
select 'invoice_number_seq exists', '1',
  (select count(*)::text from information_schema.sequences
   where sequence_schema = 'sonario' and sequence_name = 'invoice_number_seq')
union all
select 'unique(term_id, profile_id) on invoices', '1',
  (select count(*)::text from pg_indexes where schemaname = 'sonario'
   and tablename = 'invoices' and indexdef ilike '%unique%term_id%profile_id%' )
union all
select 'functions exist (init + create_run)', '2',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sonario' and p.proname in ('initialize_invoice_numbering', 'create_invoice_run'))
union all
select 'policies (settings x2, runs x1, invoices x2)', '5',
  (select count(*)::text from pg_policies where schemaname = 'sonario'
   and tablename in ('invoice_settings', 'invoice_runs', 'invoices'))
union all
select 'sequence not directly usable by authenticated', '0',
  (select count(*)::text from information_schema.role_usage_grants
   where object_schema = 'sonario' and object_name = 'invoice_number_seq'
   and grantee in ('authenticated', 'anon'));

-- ============================================================================
-- Rollback
-- ============================================================================
-- drop policy if exists "super updates invoice due date" on sonario.invoices;
-- drop policy if exists "super reads invoices" on sonario.invoices;
-- drop policy if exists "super reads invoice runs" on sonario.invoice_runs;
-- drop policy if exists "super updates invoice settings" on sonario.invoice_settings;
-- drop policy if exists "super reads invoice settings" on sonario.invoice_settings;
-- drop function if exists sonario.create_invoice_run(uuid, date, date, integer, uuid[]);
-- drop function if exists sonario.initialize_invoice_numbering(integer);
-- drop trigger if exists invoices_enforce_immutability on sonario.invoices;
-- drop function if exists sonario.enforce_invoice_immutability();
-- drop trigger if exists invoice_settings_lock_numbering on sonario.invoice_settings;
-- drop function if exists sonario.enforce_invoice_settings_numbering_lock();
-- drop trigger if exists invoice_settings_set_updated_at on sonario.invoice_settings;
-- drop sequence if exists sonario.invoice_number_seq;
-- drop table if exists sonario.invoices;
-- drop table if exists sonario.invoice_runs;
-- drop table if exists sonario.invoice_settings;
