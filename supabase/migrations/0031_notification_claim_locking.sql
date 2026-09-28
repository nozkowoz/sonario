-- ============================================================================
-- 0031 — Race-safe claiming for scheduled/automated notifications
--
-- Nina, 2026-09-28: "please design this so concurrent scheduler executions cannot both send
-- before the row is updated. I want explicit idempotency/locking, not just select status then send."
--
-- sonario.claim_notification_send() is the one place any scheduled rule "claims the right to send"
-- a given logical notification (identified by dedupe_key). It's a single atomic statement per
-- path, so two concurrent callers can never both win the same key:
--   - insert ... on conflict (dedupe_key) do nothing  → wins a BRAND NEW key
--   - update ... where dedupe_key = X and status = 'failed' or stale-pending → RECLAIMS one
-- Postgres's row-level locking makes each of those atomic on its own; there's no separate
-- select-then-decide step for two workers to race inside.
--
-- sent = terminal — never matched by either path again.
-- failed = retryable — matched by the reclaim path.
-- pending = exclusive — NOT reclaimable unless it's stale (claimed_at older than 10 minutes),
--   which covers a worker that claimed a send and then crashed/timed out before finalizing it to
--   sent/failed. This 10-minute stale-pending rule is my own addition to close that gap — flagging
--   it explicitly since it wasn't in the original spec, happy to tune the window.
-- ============================================================================

alter table sonario.notification_log
  add column claimed_at timestamptz,
  add column related_invoice_id uuid references sonario.invoices(id) on delete set null;

create or replace function sonario.claim_notification_send(
  p_profile_id uuid, p_type text, p_dedupe_key text,
  p_related_rehearsal_id uuid default null,
  p_related_song_id uuid default null,
  p_related_invoice_id uuid default null
) returns sonario.notification_log
language plpgsql security definer set search_path to ''
as $$
declare result sonario.notification_log;
begin
  insert into sonario.notification_log
    (profile_id, type, dedupe_key, related_rehearsal_id, related_song_id, related_invoice_id,
     status, claimed_at)
  values
    (p_profile_id, p_type, p_dedupe_key, p_related_rehearsal_id, p_related_song_id,
     p_related_invoice_id, 'pending', now())
  on conflict (dedupe_key) do nothing
  returning * into result;

  if result.id is not null then
    return result;
  end if;

  update sonario.notification_log
    set status = 'pending', claimed_at = now()
    where dedupe_key = p_dedupe_key
      and (status = 'failed' or (status = 'pending' and claimed_at < now() - interval '10 minutes'))
    returning * into result;

  return result; -- null means another worker already legitimately holds this key
end;
$$;

-- Only the service role (Edge Functions) calls this — it's the scheduler's own primitive, never
-- something a member/admin/super triggers directly from the client.
revoke all on function sonario.claim_notification_send(uuid, text, text, uuid, uuid, uuid) from public, authenticated, anon;
grant execute on function sonario.claim_notification_send(uuid, text, text, uuid, uuid, uuid) to service_role;

create or replace function sonario.finalize_notification_send(p_id uuid, p_status text, p_delivery_result text default null)
returns sonario.notification_log
language plpgsql security definer set search_path to ''
as $$
declare result sonario.notification_log;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'finalize_notification_send only accepts sent or failed, got %', p_status;
  end if;
  update sonario.notification_log
    set status = p_status, delivery_result = p_delivery_result,
        sent_at = case when p_status = 'sent' then now() else sent_at end
    where id = p_id
    returning * into result;
  return result;
end;
$$;

revoke all on function sonario.finalize_notification_send(uuid, text, text) from public, authenticated, anon;
grant execute on function sonario.finalize_notification_send(uuid, text, text) to service_role;

-- ============================================================================
-- Verification
-- ============================================================================
select 'claim_notification_send exists' as check_name, 'true' as expected,
  (exists (select 1 from pg_proc where proname = 'claim_notification_send' and pronamespace = 'sonario'::regnamespace))::text
union all
select 'finalize_notification_send exists', 'true',
  (exists (select 1 from pg_proc where proname = 'finalize_notification_send' and pronamespace = 'sonario'::regnamespace))::text
union all
select 'related_invoice_id exists', 'true',
  (exists (select 1 from information_schema.columns
   where table_schema = 'sonario' and table_name = 'notification_log' and column_name = 'related_invoice_id'))::text;
