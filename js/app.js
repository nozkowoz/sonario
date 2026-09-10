import { html, render, useState } from './lib.js';
import { supabase } from './supabaseClient.js';
import {
  useSession, useMyMembership, displayNameOf, isSuper,
  useEvents, useTerms, useAbsences, useCheckins, useAwayDates, useMemberDirectory, awayRangeFor,
} from './store.js';
import { SignInScreen, MembershipStatusScreen } from './auth.js';
import { LoadingState, ErrorState, EmptyState, BottomNav, Sheet, useActiveTab } from './shell.js';
import { EventDetail, eventTitle } from './events.js';
import { HomeTab } from './home.js';
import { CalendarTab } from './calendar.js';
import { AdminTab } from './admin.js';
import { CHOIR_NAME, APP_VERSION } from './config.js';

// Home and More are deliberately role-blind: a super sees exactly what an ordinary member sees,
// so Nina can judge the member experience without switching accounts. Organiser controls live on
// the super-only Admin tab, plus inline on Calendar where they're tied to a specific event.
// Repertoire/recordings/leaderboard/social remain later checkpoints and aren't wired up here.
function App() {
  const session = useSession();

  if (session === undefined) {
    return html`<div class="loading-shell"><div class="spinner"></div><p>Loading…</p></div>`;
  }
  if (!session) {
    return html`<${SignInScreen} />`;
  }
  return html`<${Gated} session=${session} />`;
}

function Gated({ session }) {
  const { membership, profile, error, retry } = useMyMembership(session);

  if (error) {
    return html`
      <div class="loading-shell">
        <${ErrorState} title="Couldn't load your account" body=${error} onRetry=${retry} />
      </div>
    `;
  }
  if (membership === undefined || profile === undefined) {
    return html`<div class="loading-shell"><div class="spinner"></div><p>Loading…</p></div>`;
  }
  if (!membership || membership.status !== 'active') {
    return html`<${MembershipStatusScreen} status=${membership?.status} onSignOut=${() => supabase.auth.signOut()} />`;
  }
  return html`<${Main} session=${session} membership=${membership} profile=${profile} />`;
}

function Main({ session, membership, profile }) {
  const canManage = isSuper(membership);
  const [tab, setTab] = useActiveTab('home');
  // If a super is demoted while sitting on the Admin tab (role arrives over realtime), fall back
  // rather than leaving them on a screen that no longer belongs to them.
  const activeTab = tab === 'admin' && !canManage ? 'home' : tab;
  // Which Admin screen is open, and optionally which event to edit — set from Calendar's
  // "Manage this event" so an organiser doesn't have to find the event again in a second list.
  const [adminView, setAdminView] = useState(null);
  const manageEvent = (ev) => { setAdminView({ section: 'events', editId: ev.id }); setTab('admin'); };
  // ONE event sheet for the whole app, owned here rather than by a tab. Nina's Figma opens an
  // event as a sheet over whatever screen you were on, so Home and Calendar both need it — and
  // this is also where the data it wants (terms, absences, check-ins, leave, the directory)
  // already lives. Keyed by id, not by the row object, so a realtime update to the event while
  // the sheet is open is reflected instead of being frozen at the moment it was tapped.
  const [openEventId, setOpenEventId] = useState(null);

  // Events/terms/absences/check-ins load once here rather than per tab: both Home and Calendar need the
  // same rows, useLiveTable names its realtime channel after the table, and switching tabs
  // shouldn't tear down and re-open a subscription (or briefly re-show a loading state).
  const { events, loading: eventsLoading } = useEvents();
  const { terms } = useTerms();
  const { absences } = useAbsences();
  const { checkins } = useCheckins();
  const { awayDates } = useAwayDates();
  // Only supers ever render another member's name, so members don't call the directory at all.
  const { directory } = useMemberDirectory(canManage);

  const termsById = Object.fromEntries(terms.map((t) => [t.id, t]));
  const openEvent = openEventId ? events.find((e) => e.id === openEventId) : null;
  const forEvent = (rows, id) => rows.filter((r) => r.rehearsal_id === id);
  const mineFor = (rows, id) => rows.find((r) => r.rehearsal_id === id && r.profile_id === profile.id);

  return html`
    <div>
      <header class="app-header">
        <div class="app-header-inner">
          <h1 class="app-title">${CHOIR_NAME}</h1>
          <button class="avatar-btn" title=${displayNameOf(profile)}
            aria-label=${`${displayNameOf(profile)} — open More`} onClick=${() => setTab('more')}>
            ${profile.avatar_url
              // Google gives us this on sign-in, so the mockup's avatar costs nothing. This is not
              // the deferred profile-photo *upload* — there's no upload here, just what Google
              // already returned. Initials cover an email sign-in, which has no picture.
              ? html`<img class="avatar" src=${profile.avatar_url} alt="" referrerpolicy="no-referrer" />`
              : html`<span class="avatar avatar-initials">${initialsOf(profile)}</span>`}
          </button>
        </div>
      </header>
      <main class="app-main">
        ${activeTab === 'home' ? html`
          <${HomeTab}
            profile=${profile}
            events=${events} loading=${eventsLoading} terms=${terms}
            absences=${absences} checkins=${checkins}
            onNavigate=${setTab}
            onOpenEvent=${(ev) => setOpenEventId(ev.id)}
          />
        ` : null}
        ${activeTab === 'calendar' ? html`
          <${CalendarTab}
            profileId=${profile.id}
            events=${events} loading=${eventsLoading} terms=${terms}
            absences=${absences} checkins=${checkins} awayDates=${awayDates}
            onOpenEvent=${(ev) => setOpenEventId(ev.id)}
          />
        ` : null}
        ${activeTab === 'repertoire' ? html`
          <div class="tab-content">
            <h2>Repertoire</h2>
            <${EmptyState} title="Not built yet"
              body="Songs, voice parts and practice recordings land here. The tab is in the nav because the navigation is locked — see DESIGN-RULES.md." />
          </div>
        ` : null}
        ${activeTab === 'more' ? html`<${MoreTab} profile=${profile} />` : null}
        ${activeTab === 'admin' && canManage
          ? html`<${AdminTab} session=${session} view=${adminView} setView=${setAdminView}
              events=${events} eventsLoading=${eventsLoading} terms=${terms} />`
          : null}
      </main>
      <p class="app-footer">${APP_VERSION}</p>
      <${BottomNav} active=${activeTab} onChange=${setTab} canManage=${canManage} />

      ${openEvent ? html`
        <${Sheet} label=${eventTitle(openEvent)} onClose=${() => setOpenEventId(null)}>
          <${EventDetail}
            event=${openEvent}
            term=${openEvent.term_id ? termsById[openEvent.term_id] : null}
            myAbsence=${mineFor(absences, openEvent.id)}
            myCheckin=${mineFor(checkins, openEvent.id)}
            myAway=${awayRangeFor(openEvent, awayDates, profile.id)}
            absencesForEvent=${forEvent(absences, openEvent.id)}
            checkinsForEvent=${forEvent(checkins, openEvent.id)}
            canManage=${canManage}
            profileId=${profile.id}
            directory=${directory}
            onManage=${canManage ? (ev) => { setOpenEventId(null); manageEvent(ev); } : null}
          />
        <//>
      ` : null}
    </div>
  `;
}

// Identical for every member, super or not. Nothing role-dependent belongs on this screen.
function MoreTab({ profile }) {
  return html`
    <div class="tab-content">
      <h2>More</h2>
      <${EmptyState} title="Nothing here yet" body="Repertoire, recordings and settings land in later builds." />
      <div class="more-account">
        <p class="eyebrow">Account</p>
        <p class="more-account-name">${displayNameOf(profile)}</p>
        <button class="btn btn-outline btn-sm" onClick=${() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  `;
}

// First letters of the first two words — "Nina Kowalski" becomes NK.
function initialsOf(profile) {
  const parts = (displayNameOf(profile) || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

render(html`<${App} />`, document.getElementById('root'));
