import { useEffect, useState } from './lib.js';
import { supabase } from './supabaseClient.js';

// Current auth session, kept live via onAuthStateChange. `undefined` means "still checking",
// `null` means "signed out" — App.js uses that distinction to show a loading state vs AuthGate.
export function useSession() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return session;
}

// The current user's own profile + membership — role/status now live only in the database
// (sonario.memberships), never in JWT/user_metadata. `undefined` = still loading, `null` = the
// signup trigger hasn't run yet (shouldn't happen in practice, but don't crash if it hasn't).
export function useMyMembership(session) {
  const [membership, setMembership] = useState(undefined);
  const [profile, setProfile] = useState(undefined);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!session) { setMembership(session === null ? null : undefined); setProfile(session === null ? null : undefined); return; }
    let cancelled = false;

    const load = () => {
      setError(null);
      supabase.from('memberships').select('*').eq('profile_id', session.user.id).maybeSingle()
        .then(({ data, error: err }) => {
          if (cancelled) return;
          if (err) { setError(err.message); return; }
          setMembership(data ?? null);
        });
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
        .then(({ data, error: err }) => {
          if (cancelled) return;
          if (err) { setError(err.message); return; }
          setProfile(data ?? null);
        });
    };
    load();

    const channel = supabase
      .channel(`membership-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'sonario', table: 'memberships', filter: `profile_id=eq.${session.user.id}` }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [session?.user?.id, reloadKey]);

  return { membership, profile, error, retry: () => setReloadKey((k) => k + 1) };
}

export function displayNameOf(profile) {
  return profile?.display_name || '';
}

export function isSuper(membership) {
  return membership?.role === 'super';
}

// Super-only: the pending-approval queue + every membership for management (deactivate/reactivate).
export function useAllMemberships() {
  const { rows, loading } = useLiveTable('memberships');
  return { memberships: rows, loading };
}

// Role changes only. Kept separate from decideMembership so a promotion can never accidentally
// rewrite someone's status (or vice versa) by sharing a patch object.
//
// The database already allowed this — `super decides memberships` is
// `is_super() AND profile_id <> auth.uid()` — so nothing new is being opened up here; the UI
// simply never offered it. That policy also gives the system a useful property for free: a super
// can never change their OWN row, so however many supers demote each other, the last one standing
// cannot demote themselves. The choir cannot be locked out of its own admin.
export async function setMemberRole(profileId, role, decidedBy) {
  return supabase.from('memberships')
    .update({ role, decided_at: new Date().toISOString(), decided_by: decidedBy })
    .eq('profile_id', profileId)
    .select();
}

export async function decideMembership(profileId, { status, role }, decidedBy) {
  const patch = { status, decided_at: new Date().toISOString(), decided_by: decidedBy };
  if (role) patch.role = role;
  return supabase.from('memberships').update(patch).eq('profile_id', profileId).select();
}

// Generic live-synced table hook — fetch once, then patch in place from postgres_changes so
// every open tab shares one live view. `orderFn` runs client-side after each patch so realtime
// inserts land in the right spot without a second round trip to the server.
function useLiveTable(table, { select = '*', orderFn } = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    supabase.from(table).select(select).then(({ data, error }) => {
      if (cancelled) return;
      if (!error && data) setRows(orderFn ? [...data].sort(orderFn) : data);
      setLoading(false);
    });

    const channel = supabase
      .channel(`${table}-changes`)
      .on('postgres_changes', { event: '*', schema: 'sonario', table }, (payload) => {
        setRows((prev) => {
          let next = prev;
          if (payload.eventType === 'INSERT') {
            if (prev.some((r) => r.id === payload.new.id)) return prev;
            next = [...prev, payload.new];
          } else if (payload.eventType === 'UPDATE') {
            next = prev.map((r) => (r.id === payload.new.id ? payload.new : r));
          } else if (payload.eventType === 'DELETE') {
            next = prev.filter((r) => r.id !== payload.old.id);
          } else {
            return prev;
          }
          return orderFn ? [...next].sort(orderFn) : next;
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [table]);

  return { rows, loading };
}

export function useRehearsals() {
  const { rows, loading } = useLiveTable('rehearsals', {
    orderFn: (a, b) => a.rehearsal_date.localeCompare(b.rehearsal_date),
  });
  return { rehearsals: rows, loading };
}

// The pre-rebuild `useRsvps`/`useCheckins` hooks that used to sit here are gone: they pointed at
// `rehearsal_rsvps` and `rehearsal_checkins`, neither of which exists in the current schema
// (RSVPs became the absence-only model, and check-ins live in `checkins`). Nothing imported
// them — the dead components query those old tables directly — and the name `useCheckins` is now
// the real Step D hook further down.
export function useSocialEvents() {
  const { rows, loading } = useLiveTable('social_events', {
    orderFn: (a, b) => a.event_date.localeCompare(b.event_date),
  });
  return { socialEvents: rows, loading };
}

export function useSocialRsvps() {
  const { rows, loading } = useLiveTable('social_rsvps');
  return { socialRsvps: rows, loading };
}

export function useSongs() {
  const { rows, loading } = useLiveTable('songs', {
    orderFn: (a, b) => a.title.localeCompare(b.title),
  });
  return { songs: rows, loading };
}

export function useNotices() {
  const { rows, loading } = useLiveTable('notices', {
    orderFn: (a, b) => (b.pinned - a.pinned) || b.created_at.localeCompare(a.created_at),
  });
  return { notices: rows, loading };
}

// ===========================================================================
// Step C — unified events, terms, absences, member directory.
//
// "Events" are rows in `sonario.rehearsals`: the table keeps its original name (decision 5 in
// HANDOVER.md §6) but holds every event type via `event_type`. Everything below says "event" in
// product language and `rehearsal_*` at the wire level; that mismatch is deliberate and agreed.
// ===========================================================================

const byDateThenStart = (a, b) =>
  a.rehearsal_date.localeCompare(b.rehearsal_date) ||
  String(a.start_time || '').localeCompare(String(b.start_time || ''));

export function useEvents() {
  const { rows, loading } = useLiveTable('rehearsals', { orderFn: byDateThenStart });
  return { events: rows, loading };
}

export function useTerms() {
  const { rows, loading } = useLiveTable('terms', {
    orderFn: (a, b) => b.starts_on.localeCompare(a.starts_on),
  });
  return { terms: rows, loading };
}

// One hook for both audiences, because RLS already draws the line: "own absence or super reads"
// means an ordinary member gets back only their own rows here and a super gets everybody's.
// The client never has to decide who's allowed to see what — it just renders what came back.
export function useAbsences() {
  const { rows, loading } = useLiveTable('rehearsal_absences');
  return { absences: rows, loading };
}

// The ONLY way member-facing UI may resolve another member's name. `profiles` is own-row-or-super
// under RLS, so a direct `profiles` select silently returns nothing for a non-super — see
// HANDOVER.md §3. This RPC returns id/display_name/avatar_url for active members only, and only
// to an active caller. `enabled` is here so member-facing screens that never need other people's
// names don't call it at all.
export function useMemberDirectory(enabled = true) {
  const [byId, setById] = useState({});
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) { setById({}); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    supabase.rpc('member_directory').then(({ data, error }) => {
      if (cancelled) return;
      if (!error && data) setById(Object.fromEntries(data.map((m) => [m.id, m])));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [enabled]);

  return { directory: byId, loading };
}

// --- Event mutations (super only — enforced by the "super manage rehearsals" policy, not by
// --- whether the client chose to render the button). -------------------------------------

export const EVENT_TYPES = ['rehearsal', 'workshop', 'performance', 'social'];

export async function createEvent(fields) {
  return supabase.from('rehearsals').insert(eventPayload(fields)).select().maybeSingle();
}

export async function updateEvent(id, fields) {
  return supabase.from('rehearsals').update(eventPayload(fields)).eq('id', id).select().maybeSingle();
}

// Cancelling is a status flip, never a delete: absences and (later) check-ins hang off this row
// by FK with `on delete cascade`, so deleting an event would silently destroy attendance history.
// Matches the archive-don't-delete pattern used elsewhere in this schema.
export async function setEventStatus(id, status) {
  return supabase.from('rehearsals').update({ status }).eq('id', id).select().maybeSingle();
}

// Whitelist rather than spreading the form state straight through, so a stray field (or a
// client-supplied created_at/updated_at) can never reach the table.
function eventPayload(f) {
  return {
    event_type: f.event_type,
    title: f.title?.trim() ? f.title.trim() : null,
    description: f.description?.trim() || '',
    rehearsal_date: f.rehearsal_date,
    start_time: f.start_time,
    end_time: f.end_time,
    location: f.location?.trim() || '',
    term_id: f.term_id || null,
    counts_towards_attendance: !!f.counts_towards_attendance,
  };
}

// --- Absence marking (the whole "can't make it" model — a row exists or it doesn't) -------

export async function markAbsent(eventId, profileId) {
  return supabase.from('rehearsal_absences').insert({ rehearsal_id: eventId, profile_id: profileId }).select().maybeSingle();
}

export async function clearAbsence(eventId, profileId) {
  return supabase.from('rehearsal_absences').delete()
    .eq('rehearsal_id', eventId).eq('profile_id', profileId);
}

// --- Leave / away dates ----------------------------------------------------

// Same single-hook-for-both-audiences shape as absences and check-ins: `away_dates` is
// own-row-or-super under RLS (tightened in migration 0002), so a member gets only their own
// ranges back and a super gets everyone's.
export function useAwayDates() {
  const { rows, loading } = useLiveTable('away_dates', {
    orderFn: (a, b) => a.starts_on.localeCompare(b.starts_on),
  });
  return { awayDates: rows, loading };
}

// Leave is a RANGE, so a member away on holiday doesn't mark every affected rehearsal one by one.
// `status` defaults to 'pending' in the schema and there is a "super confirms away dates" policy,
// but no organiser UI performs that confirmation — so the app treats logged leave as effective
// immediately and only 'cancelled' stops counting. Don't gate a member's own view on an approval
// step nobody can currently carry out.
export async function logLeave({ startsOn, endsOn, note }, profileId) {
  return supabase.from('away_dates')
    .insert({ profile_id: profileId, starts_on: startsOn, ends_on: endsOn, note: note || '' })
    .select();
}

// Not a delete — there is no DELETE policy on away_dates. Cancelling is a status flip, and the
// update policy permits it only `while status = 'pending'`: once a super confirms a range, this
// matches zero rows and the caller must report that rather than showing success.
export async function cancelLeave(id) {
  return supabase.from('away_dates')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .select();
}

// A member is away for an event if any of their non-cancelled ranges covers its date. Plain
// string comparison is safe and deliberate: these are all ISO yyyy-mm-dd date strings, so this
// never goes near a Date object and can't be shifted by a timezone.
export function awayRangeFor(event, awayDates, profileId) {
  return awayDates.find((a) => a.profile_id === profileId
    && a.status !== 'cancelled'
    && a.starts_on <= event.rehearsal_date
    && a.ends_on >= event.rehearsal_date) || null;
}

// --- Check-in (Step D) -----------------------------------------------------

// Same single-hook-for-both-audiences reasoning as useAbsences: `checkins` is own-row-or-super
// under RLS, so a member gets only their own row back and a super gets the whole event's.
export function useCheckins() {
  const { rows, loading } = useLiveTable('checkins');
  return { checkins: rows, loading };
}

// `checked_in_at` is deliberately not sent: a BEFORE INSERT trigger (migration 0003) overwrites
// it with the server clock, so passing a client time would be pointless as well as wrong.
// `source: 'live'` is the only value a member is allowed to insert — 'friend_confirmed' belongs
// to peer verification, which is a later checkpoint.
export async function checkIn(eventId, profileId) {
  return supabase.from('checkins')
    .insert({ rehearsal_id: eventId, profile_id: profileId, source: 'live' })
    .select().maybeSingle();
}

// Undo is a delete, allowed by policy only within an hour of the check-in. Outside the window
// the delete matches no rows rather than failing loudly, which is why the caller treats an empty
// result as a failure.
export async function undoCheckIn(eventId, profileId) {
  return supabase.from('checkins').delete()
    .eq('rehearsal_id', eventId).eq('profile_id', profileId)
    .select();
}
