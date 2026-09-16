-- ============================================================================
-- 0017 — Push notifications, Stage A: the minimum additive schema infrastructure needs
--
-- Nina, 2026-09-17, after a full preflight against the existing (inert since migration 0001)
-- push_subscriptions/notification_log tables. Two changes, both to notification_log, both
-- additive — push_subscriptions needs nothing at all, it's already the exact shape a Web Push
-- subscription requires.
--
-- 1. related_song_id: the existing related_rehearsal_id can't represent a lyrics-release
--    notification (which is about a song, not a rehearsal). Adding one more nullable FK rather
--    than generalising to a polymorphic entity_type/entity_id pair — Nina's explicit call: "It's
--    simpler than introducing a polymorphic notification entity model before you actually need
--    one." If a third unrelated entity type shows up later (invoices were mentioned), revisit then.
--
-- 2. status + created_at, and sent_at becomes genuinely nullable: the ORIGINAL sent_at was
--    `not null default now()`, meaning every insert already looked "sent" the moment it existed —
--    that's exactly the bug Nina flagged: "a temporary provider error could create a log row and
--    permanently suppress a valid notification" if dedupe just checks "does a row exist". The real
--    design (Stage A, implemented in the send-test-notification Edge Function):
--      - INSERT a row with status='pending' FIRST, before attempting to send anything. The
--        existing unique(dedupe_key) constraint is what makes this an atomic claim — if a
--        concurrent invocation (a retry, or two overlapping cron/webhook firings) tries the same
--        insert, exactly one succeeds; the other gets a unique_violation and knows someone else
--        already owns this logical notification.
--      - On a unique_violation, look at the EXISTING row's status: 'sent' means truly done, skip.
--        'failed' means safely retryable — reclaim it with
--        `update ... set status='pending' where dedupe_key=X and status='failed'`, which is itself
--        an atomic conditional update (only one concurrent reclaimer can win). 'pending' means
--        another invocation is currently mid-send; skip rather than race it, unless created_at is
--        old enough to treat as a stalled/crashed attempt worth reclaiming (the Edge Function's own
--        judgement call, not enforced here — the schema just needs to be able to tell the states
--        apart).
--      - After actually attempting delivery, UPDATE that same row: sent_at=now(), status='sent' on
--        success; status='failed' (sent_at stays null) otherwise, with a short summary in the
--        existing delivery_result text column (JSON-encoded per-device breakdown is fine as a
--        string — no type change to that column, it was already flexible enough).
--    This is what makes "one logical notification, one log row, safe under concurrent
--    scheduler/webhook execution, distinguishes real delivery from a retryable failure" all true
--    at once, per Nina's four requirements.
-- ============================================================================

alter table sonario.notification_log
  add column if not exists related_song_id uuid references sonario.songs(id) on delete set null,
  add column if not exists status text not null default 'pending',
  add column if not exists created_at timestamptz not null default now();

alter table sonario.notification_log
  drop constraint if exists notification_log_status_check;
alter table sonario.notification_log
  add constraint notification_log_status_check check (status in ('pending', 'sent', 'failed'));

-- sent_at must be able to stay null while pending/failed — see the header above for why the
-- original `not null default now()` was actively wrong for this design.
alter table sonario.notification_log alter column sent_at drop not null;
alter table sonario.notification_log alter column sent_at drop default;

-- ============================================================================
-- Verification
-- ============================================================================
select 'related_song_id column exists' as check_name, '1' as expected,
  (select count(*)::text from information_schema.columns
   where table_schema = 'sonario' and table_name = 'notification_log' and column_name = 'related_song_id') as actual
union all
select 'status column exists, defaults pending', '1',
  (select count(*)::text from information_schema.columns
   where table_schema = 'sonario' and table_name = 'notification_log' and column_name = 'status'
   and column_default ilike '%pending%')
union all
select 'created_at column exists', '1',
  (select count(*)::text from information_schema.columns
   where table_schema = 'sonario' and table_name = 'notification_log' and column_name = 'created_at')
union all
select 'sent_at is nullable now', '1',
  (select count(*)::text from information_schema.columns
   where table_schema = 'sonario' and table_name = 'notification_log' and column_name = 'sent_at'
   and is_nullable = 'YES')
union all
select 'status check constraint enforces the 3 states', '1',
  (select count(*)::text from pg_constraint where conname = 'notification_log_status_check');

-- ============================================================================
-- Rollback
-- ============================================================================
-- alter table sonario.notification_log alter column sent_at set default now();
-- alter table sonario.notification_log alter column sent_at set not null;
-- alter table sonario.notification_log drop constraint if exists notification_log_status_check;
-- alter table sonario.notification_log drop column if exists created_at;
-- alter table sonario.notification_log drop column if exists status;
-- alter table sonario.notification_log drop column if exists related_song_id;
