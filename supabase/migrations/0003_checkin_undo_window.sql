-- ============================================================================
-- 0003 — Check-in: the one-hour undo window, plus the two server-side guards that make a
-- check-in timestamp worth trusting. Step D of the MVP run.
--
-- Checkpoint 2 shipped `sonario.checkins` with only two policies: an own-row-or-super select
-- and an insert restricted to your own row. That left three gaps, all of which this migration
-- closes:
--
-- 1. NO DELETE POLICY AT ALL, so the agreed one-hour undo window (decision 7 in HANDOVER.md §6)
--    was structurally impossible — a member who tapped the wrong button was stuck with it. The
--    window is expressed here as a policy rather than as UI state, because "hide the button
--    after an hour" is not a rule, it's a suggestion.
--
-- 2. `checked_in_at` WAS CLIENT-SUPPLIABLE. The column defaults to now() and Checkpoint 2's
--    comment says a live insert "should simply omit this column" — but nothing stopped a client
--    from passing its own value, and punctuality tiers are computed from exactly this column.
--    Now a BEFORE INSERT trigger overwrites whatever arrives, so the timestamp is always the
--    server's clock. This is also what makes decision 8 enforceable rather than aspirational:
--    when peer verification is eventually built, its "approximate arrival time" cannot reach
--    this column even if the code that writes it is wrong.
--
-- 3. A MEMBER COULD CHECK IN TO ANY EVENT, on any date — including one months away, or one that
--    has been cancelled. Attendance for a Tuesday rehearsal is a claim about being in the room
--    on that Tuesday, so the insert policy now requires the event to be happening today
--    (Melbourne local date) and not cancelled. NOTE: this is a new rule, not a previously agreed
--    one — it is the narrowest sensible constraint, and if the choir wants a grace window
--    ("check in the morning after") the date test below is the one line to relax.
--
-- Deliberately NOT added here:
-- * No update policy. A check-in is insert-once, delete-to-undo; there is nothing about an
--   existing row a member should be able to edit, and the absence of an update policy is what
--   keeps the server timestamp immutable after the fact.
-- * No super delete/override. A super fixing someone else's attendance is the job of
--   `attendance_corrections` (which already exists, with an audit trail: who corrected what and
--   why) at a later checkpoint. Giving supers a silent delete now would create an unaudited path
--   through exactly the data that table exists to keep honest.
-- ============================================================================

-- --- Guard 2: the server owns the timestamp ---------------------------------
-- A live check-in always gets now(); a friend-confirmed row always gets null (which is what the
-- existing `check (source = 'live' or checked_in_at is null)` constraint already demands — this
-- makes it true by construction instead of rejecting the insert).
create or replace function sonario.enforce_checkin_timestamp()
returns trigger as $$
begin
  if new.source = 'live' then
    new.checked_in_at = now();
  else
    new.checked_in_at = null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = '';

drop trigger if exists checkins_server_timestamp on sonario.checkins;
create trigger checkins_server_timestamp
  before insert on sonario.checkins
  for each row execute function sonario.enforce_checkin_timestamp();

revoke execute on function sonario.enforce_checkin_timestamp() from public;

-- --- Guard 3: you can only check in to today's event ------------------------
-- Replaces Checkpoint 2's "members write own checkin". `source = 'live'` is pinned here too: a
-- member self-inserting a `friend_confirmed` row would be forging someone else's vouching.
--
-- The timezone is hardcoded because this is one choir in one city; `rehearsal_date` is a plain
-- `date`, so "today" has to be resolved against a real zone or it silently means UTC (which is
-- the previous day for most of a Melbourne evening rehearsal — the same class of bug the
-- localDateStr()/todayStr() helpers exist to prevent on the client side).
drop policy if exists "members write own checkin" on sonario.checkins;
create policy "members check in to today's event" on sonario.checkins for insert
  with check (
    sonario.is_active_member()
    and profile_id = auth.uid()
    and source = 'live'
    and exists (
      select 1 from sonario.rehearsals r
      where r.id = rehearsal_id
        and r.status <> 'cancelled'
        and r.rehearsal_date = (now() at time zone 'Australia/Melbourne')::date
    )
  );

-- --- Guard 1: the one-hour undo window --------------------------------------
-- Deleting the row is the whole undo — same shape as reversing an absence. Unlike an absence
-- (which a member may change freely right up until the event, decision 7), a check-in is a
-- statement about something that already happened, so it stops being editable an hour later.
create policy "members undo own checkin within an hour" on sonario.checkins for delete
  using (
    profile_id = auth.uid()
    and checked_in_at is not null
    and checked_in_at > now() - interval '1 hour'
  );

-- ============================================================================
-- Rollback (run manually if this migration needs to be reverted)
-- ============================================================================
-- drop policy if exists "members undo own checkin within an hour" on sonario.checkins;
-- drop policy if exists "members check in to today's event" on sonario.checkins;
-- create policy "members write own checkin" on sonario.checkins for insert
--   with check (sonario.is_active_member() and profile_id = auth.uid());
-- drop trigger if exists checkins_server_timestamp on sonario.checkins;
-- drop function if exists sonario.enforce_checkin_timestamp();
