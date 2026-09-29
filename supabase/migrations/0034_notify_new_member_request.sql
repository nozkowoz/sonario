-- ============================================================================
-- 0034 — Notify Admin/Super Admin when someone requests to join
--
-- Nina, 2026-09-29: found by hitting the gap herself (Olivia's request went through fine, but no
-- push ever fired to tell her). Event-triggered, not scheduled — fires the moment a new
-- memberships row lands with status 'pending' (i.e. handle_new_auth_user's normal fallthrough
-- path for anyone not in pre_approved_members).
--
-- The trigger calls the notify-new-member-request Edge Function via pg_net, fire-and-forget, so
-- a slow or failing push send can never block someone's actual sign-in. It reads the service role
-- key from Supabase Vault rather than a hardcoded value, because this file is committed to git —
-- see the note below the migration for the one-off, NOT-committed command that puts the real key
-- in the vault.
-- ============================================================================

create or replace function sonario.notify_new_member_request()
returns trigger
language plpgsql security definer set search_path to ''
as $$
declare
  service_key text;
begin
  if new.status != 'pending' then
    return new;
  end if;

  select decrypted_secret into service_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;

  if service_key is null then
    return new; -- vault secret not set up yet; never block the signup itself over this
  end if;

  perform net.http_post(
    url := 'https://rwkaofshfatqqkupeqoe.supabase.co/functions/v1/notify-new-member-request',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object('profileId', new.profile_id)
  );
  return new;
end;
$$;

drop trigger if exists memberships_notify_new_request on sonario.memberships;
create trigger memberships_notify_new_request
  after insert on sonario.memberships
  for each row execute function sonario.notify_new_member_request();

-- ============================================================================
-- Verification
-- ============================================================================
select 'notify_new_member_request() exists' as check_name, 'true' as expected,
  (exists (select 1 from pg_proc where proname = 'notify_new_member_request' and pronamespace = 'sonario'::regnamespace))::text
union all
select 'trigger exists', 'true',
  (exists (select 1 from pg_trigger where tgname = 'memberships_notify_new_request'))::text;

-- ============================================================================
-- DO NOT COMMIT — run this SEPARATELY, once, in the SQL editor, with your real key.
-- Get the service_role key from: Supabase dashboard > Project Settings > API.
-- ============================================================================
-- select vault.create_secret('YOUR_REAL_SERVICE_ROLE_KEY', 'service_role_key', 'Used by DB triggers calling Edge Functions via pg_net');
