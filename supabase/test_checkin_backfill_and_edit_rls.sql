-- ============================================================================
-- Adversarial RLS test — checkins backfill + edit-time policies (migration 0012)
--
-- Run AFTER 0012 is applied and AFTER seed_test_data.sql's fake identities exist. Uses the fixed
-- f0000000-... test uuids, not real members, and picks real past/future rehearsals from your
-- actual schedule so this exercises genuine data rather than an invented fixture.
--
-- Single-result pattern: one transaction, any failed check raises immediately naming what failed;
-- if everything passes, only the final SELECT's row prints.
-- ============================================================================

do $$
declare
  v_past_rehearsal    uuid;
  v_future_rehearsal  uuid;
  v_super             uuid := 'f0000000-0000-0000-0000-000000000001'; -- Marguerite Okafor, super
  v_member1           uuid := 'f0000000-0000-0000-0000-000000000002'; -- Dev Raman, active/member
  v_member2           uuid := 'f0000000-0000-0000-0000-000000000003'; -- Priya Venkatesan, active/member
  v_checkin_id        uuid;
  v_count             int;
  v_checked_in_at     timestamptz;
  v_source            text;
begin
  select id into v_past_rehearsal from sonario.rehearsals
    where status <> 'cancelled' and rehearsal_date < (now() at time zone 'Australia/Melbourne')::date
    order by rehearsal_date desc limit 1;
  select id into v_future_rehearsal from sonario.rehearsals
    where status <> 'cancelled' and rehearsal_date >= (now() at time zone 'Australia/Melbourne')::date
    order by rehearsal_date asc limit 1;
  if v_past_rehearsal is null then
    raise exception 'FIXTURE MISSING: no past non-cancelled rehearsal found — seed real_schedule_2026.sql first';
  end if;
  if v_future_rehearsal is null then
    raise exception 'FIXTURE MISSING: no today-or-future non-cancelled rehearsal found';
  end if;

  -- --- fixture cleanup, as super (in case of a previous partial run) --------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from sonario.checkins where profile_id in (v_member1, v_member2)
    and rehearsal_id in (v_past_rehearsal, v_future_rehearsal);

  -- =========================================================================
  -- CHECK 1 — super backfills a PAST rehearsal for another member.
  -- =========================================================================
  insert into sonario.checkins (rehearsal_id, profile_id, source)
    values (v_past_rehearsal, v_member1, 'super_backfill')
    returning id, checked_in_at, source into v_checkin_id, v_checked_in_at, v_source;
  if v_checked_in_at is not null then
    raise exception 'CHECK 1 FAILED: backfilled row should have null checked_in_at, got %', v_checked_in_at;
  end if;
  if v_source <> 'super_backfill' then
    raise exception 'CHECK 1 FAILED: source should be super_backfill, got %', v_source;
  end if;

  -- =========================================================================
  -- CHECK 2 — super CANNOT backfill today's/a future rehearsal (must be past).
  -- =========================================================================
  begin
    insert into sonario.checkins (rehearsal_id, profile_id, source)
      values (v_future_rehearsal, v_member1, 'super_backfill');
    raise exception 'CHECK 2 FAILED: super was able to backfill a today-or-future rehearsal';
  exception when insufficient_privilege then
    null; -- expected
  end;

  -- =========================================================================
  -- CHECK 3 — an ordinary ACTIVE member (not super) cannot use the backfill
  -- path at all, even for themselves.
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_member2::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into sonario.checkins (rehearsal_id, profile_id, source)
      values (v_past_rehearsal, v_member2, 'super_backfill');
    raise exception 'CHECK 3 FAILED: an ordinary member was able to backfill a checkin';
  exception when insufficient_privilege then
    null; -- expected
  end;

  -- =========================================================================
  -- Fixture for checks 4-7: a genuine 'live' checkin, inserted as postgres
  -- (bypassing RLS) since there's no RLS path to create a 'live' row for a
  -- rehearsal that isn't literally happening today.
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', 'null', true);
  delete from sonario.checkins where id = v_checkin_id; -- clear check 1's row, not needed further
  insert into sonario.checkins (rehearsal_id, profile_id, source, checked_in_at)
    values (v_past_rehearsal, v_member1, 'live', now() - interval '2 hours')
    returning id into v_checkin_id;

  -- =========================================================================
  -- CHECK 4 — member1 can edit their OWN check-in time.
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_member1::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update sonario.checkins set checked_in_at = now() - interval '1 hour' where id = v_checkin_id
    returning checked_in_at into v_checked_in_at;
  if v_checked_in_at is null then
    raise exception 'CHECK 4 FAILED: member1 could not edit their own check-in time';
  end if;

  -- =========================================================================
  -- CHECK 5 — member2 CANNOT edit member1's check-in time.
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_member2::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update sonario.checkins set checked_in_at = now() where id = v_checkin_id;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'CHECK 5 FAILED: member2 was able to edit member1''s check-in time (% rows)', v_count;
  end if;

  -- =========================================================================
  -- CHECK 6 — a super CAN edit another member's check-in time.
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update sonario.checkins set checked_in_at = now() - interval '30 minutes' where id = v_checkin_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'CHECK 6 FAILED: super could not edit member1''s check-in time (% rows)', v_count;
  end if;

  -- =========================================================================
  -- CHECK 7 — the edit path cannot be used to repurpose a live row's source
  -- away from 'live' (e.g. into 'super_backfill').
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_member1::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update sonario.checkins set source = 'super_backfill' where id = v_checkin_id;
    raise exception 'CHECK 7 FAILED: was able to change a live checkin''s source via the edit-time policy';
  exception when insufficient_privilege then
    null; -- expected
  end;

  -- =========================================================================
  -- Fixture for checks 8-10: a fresh backfill row to test the delete policy
  -- against, independent of the live-row fixture above. Cleanup runs as
  -- postgres (bypassing RLS), not impersonated as super — there is
  -- deliberately no policy letting a super delete another member's real
  -- live check-in (that's what attendance_corrections is for), so an
  -- impersonated delete here would silently affect 0 rows and collide with
  -- the insert below on the unique (rehearsal_id, profile_id) constraint.
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', 'null', true);
  delete from sonario.checkins where id = v_checkin_id; -- the live-row fixture, done with it
  insert into sonario.checkins (rehearsal_id, profile_id, source)
    values (v_past_rehearsal, v_member1, 'super_backfill')
    returning id into v_checkin_id;

  -- =========================================================================
  -- CHECK 8 — an ordinary member cannot delete a backfill row.
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_member2::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from sonario.checkins where id = v_checkin_id;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'CHECK 8 FAILED: an ordinary member was able to delete a backfill checkin (% rows)', v_count;
  end if;

  -- =========================================================================
  -- CHECK 9 — a super CAN delete a backfill row (undoing a mis-click).
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from sonario.checkins where id = v_checkin_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'CHECK 9 FAILED: super could not delete their own backfill checkin (% rows)', v_count;
  end if;

  -- =========================================================================
  -- CHECK 10 — the backfill-delete policy cannot be used to delete a LIVE row
  -- (it's scoped to source = 'super_backfill' only), even by a super, even
  -- outside the live-checkin undo window.
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', 'null', true);
  insert into sonario.checkins (rehearsal_id, profile_id, source, checked_in_at)
    values (v_past_rehearsal, v_member1, 'live', now() - interval '3 hours')
    returning id into v_checkin_id;

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from sonario.checkins where id = v_checkin_id;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'CHECK 10 FAILED: the backfill-delete policy deleted a live check-in (% rows)', v_count;
  end if;

  -- --- cleanup, as postgres ---------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', 'null', true);
  delete from sonario.checkins where id = v_checkin_id;
end $$;

select 'ALL 10 CHECKS PASSED — checkins backfill + edit-time RLS verified' as result;
