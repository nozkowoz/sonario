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

export function displayNameOf(session) {
  return session?.user?.user_metadata?.display_name || '';
}

export function isSuper(session) {
  return session?.user?.user_metadata?.role === 'super';
}

export async function addMember(name) {
  await supabase.from('members').insert({ name }).select();
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
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
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

export function useRsvps() {
  const { rows, loading } = useLiveTable('rehearsal_rsvps');
  return { rsvps: rows, loading };
}

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
