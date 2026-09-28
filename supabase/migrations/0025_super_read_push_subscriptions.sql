-- ============================================================================
-- 0025 — Let supers read push_subscriptions, for the Notifications redesign's live
-- recipient-count preview ("23 members will receive this notification").
--
-- 0001_foundation.sql's "members manage own subscription" policy is own-row-only
-- (profile_id = auth.uid()), which is right for a member managing their own device but means a
-- super couldn't even COUNT other members' subscriptions client-side — the send-admin-notification
-- Edge Function could, since it uses the service-role key and bypasses RLS entirely, but the
-- Admin UI showing the count before sending has no such bypass. Additive read-only grant, same
-- "own row or super" shape already used on profiles (0001) — never touches the existing
-- members-manage-their-own-row policy.
-- ============================================================================

create policy "super reads all subscriptions" on sonario.push_subscriptions
  for select using (sonario.is_super());
