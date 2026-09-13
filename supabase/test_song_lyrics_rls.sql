-- ============================================================================
-- Adversarial RLS test — sonario.song_lyrics (migration 0011)
--
-- Run AFTER 0011 is applied and AFTER seed_test_data.sql's fake identities exist. Uses the fixed
-- f0000000-... test uuids, not real members. Picks a real song by title so this runs against
-- genuine repertoire data rather than an invented fixture — change SONG_TITLE below if that song
-- ever gets deleted.
--
-- Single-result pattern: this whole script is one transaction. Any check that fails raises an
-- exception immediately and the script aborts there — read the exception message to see which
-- check failed. If every check passes, the DO block completes silently and the final SELECT
-- below it is the only output.
-- ============================================================================

do $$
declare
  v_song_id      uuid;
  v_super        uuid := 'f0000000-0000-0000-0000-000000000001'; -- Marguerite Okafor, active/super
  v_member       uuid := 'f0000000-0000-0000-0000-000000000002'; -- Dev Raman, active/member
  v_member2      uuid := 'f0000000-0000-0000-0000-000000000003'; -- Priya Venkatesan, active/member
  v_pending      uuid := 'f0000000-0000-0000-0000-000000000007'; -- Callum Whitmore, pending
  v_deactivated  uuid := 'f0000000-0000-0000-0000-000000000008'; -- Rowan Deakin, deactivated
  v_lyrics_id    uuid;
  v_count        int;
  v_updated_by   uuid;
  v_released_by  uuid;
  v_released_at  timestamptz;
begin
  select id into v_song_id from sonario.songs where title = 'Can We Talk' limit 1;
  if v_song_id is null then
    raise exception 'FIXTURE MISSING: song "Can We Talk" not found — point SONG_TITLE at a real song before running this';
  end if;

  -- --- fixture cleanup, as super (in case of a previous partial run) --------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from sonario.song_lyrics where song_id = v_song_id;

  -- =========================================================================
  -- CHECK 1 + 7a — super can create/read/edit unreleased lyrics; updated_by
  -- cannot be spoofed by the client.
  -- =========================================================================
  insert into sonario.song_lyrics (song_id, lyrics, updated_by)
    values (v_song_id, 'Verse one (draft)', v_member) -- deliberately spoofing updated_by
    returning id, updated_by into v_lyrics_id, v_updated_by;

  if v_updated_by is distinct from v_super then
    raise exception 'CHECK 1/7 FAILED: updated_by was client-spoofable on insert — expected %, got %', v_super, v_updated_by;
  end if;

  select count(*) into v_count from sonario.song_lyrics where id = v_lyrics_id;
  if v_count <> 1 then
    raise exception 'CHECK 1 FAILED: super could not read back the unreleased lyrics they just created';
  end if;

  update sonario.song_lyrics set lyrics = 'Verse one (edited)', updated_by = v_member2 -- spoofing again
    where id = v_lyrics_id
    returning updated_by into v_updated_by;
  if v_updated_by is distinct from v_super then
    raise exception 'CHECK 1/7 FAILED: updated_by was client-spoofable on update — expected %, got %', v_super, v_updated_by;
  end if;

  -- =========================================================================
  -- CHECK 2 + 6 — active ORDINARY member gets no row while unreleased, and
  -- cannot insert/update/delete any row.
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_count from sonario.song_lyrics where id = v_lyrics_id;
  if v_count <> 0 then
    raise exception 'CHECK 2 FAILED: ordinary active member could read unreleased lyrics (got % rows)', v_count;
  end if;

  begin
    insert into sonario.song_lyrics (song_id, lyrics) values (v_song_id, 'sneaky insert');
    raise exception 'CHECK 6 FAILED: ordinary member was able to INSERT a lyrics row';
  exception when insufficient_privilege then
    null; -- expected: RLS rejects the insert
  end;

  update sonario.song_lyrics set lyrics = 'hacked' where id = v_lyrics_id;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'CHECK 6 FAILED: ordinary member was able to UPDATE the lyrics row (% rows affected)', v_count;
  end if;

  delete from sonario.song_lyrics where id = v_lyrics_id;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'CHECK 6 FAILED: ordinary member was able to DELETE the lyrics row (% rows affected)', v_count;
  end if;

  -- =========================================================================
  -- CHECK 3 + 7b — after release, active member can read it; released_by
  -- cannot be spoofed by the client.
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update sonario.song_lyrics
    set released_at = now(), released_by = v_member2 -- deliberately spoofing released_by
    where id = v_lyrics_id
    returning released_by, released_at into v_released_by, v_released_at;

  if v_released_by is distinct from v_super then
    raise exception 'CHECK 7 FAILED: released_by was client-spoofable — expected %, got %', v_super, v_released_by;
  end if;
  if v_released_at is null then
    raise exception 'CHECK 3 FAILED: released_at did not get set by the release update';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_count from sonario.song_lyrics where id = v_lyrics_id;
  if v_count <> 1 then
    raise exception 'CHECK 3 FAILED: active member could not read lyrics after release (got % rows)', v_count;
  end if;

  -- =========================================================================
  -- CHECK 4 — Hide lyrics clears released_at/released_by, member immediately
  -- loses access again.
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update sonario.song_lyrics set released_at = null where id = v_lyrics_id
    returning released_by into v_released_by;
  if v_released_by is not null then
    raise exception 'CHECK 4 FAILED: released_by was not cleared alongside released_at on Hide (got %)', v_released_by;
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_count from sonario.song_lyrics where id = v_lyrics_id;
  if v_count <> 0 then
    raise exception 'CHECK 4 FAILED: active member could still read lyrics after Hide (got % rows)', v_count;
  end if;

  -- =========================================================================
  -- CHECK 5 — pending and deactivated members see nothing, release state
  -- notwithstanding (re-release first so this is testing the "easy to leak"
  -- released case, not the already-covered unreleased case).
  -- =========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update sonario.song_lyrics set released_at = now() where id = v_lyrics_id;

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_pending::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from sonario.song_lyrics where id = v_lyrics_id;
  if v_count <> 0 then
    raise exception 'CHECK 5 FAILED: pending member could read released lyrics (got % rows)', v_count;
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_deactivated::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from sonario.song_lyrics where id = v_lyrics_id;
  if v_count <> 0 then
    raise exception 'CHECK 5 FAILED: deactivated member could read released lyrics (got % rows)', v_count;
  end if;

  -- --- cleanup, as super ----------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from sonario.song_lyrics where id = v_lyrics_id;

  execute 'reset role';
  perform set_config('request.jwt.claims', 'null', true);
end $$;

select 'ALL 7 CHECKS PASSED — song_lyrics RLS + audit-column enforcement verified' as result;
