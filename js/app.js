import { html, render, useState } from './lib.js';
import { supabase } from './supabaseClient.js';
import {
  useSession, useMyMembership, displayNameOf, isSuper,
  useEvents, useTerms, useAbsences, useCheckins, useAwayDates, useMemberDirectory, awayRangeFor,
  useSongs, useSongCollections, useSongCollectionItems, useSongAssignments, useRehearsalSongs,
  usePartLabels, useRecordings, useSongLyrics,
} from './store.js';
import { SignInScreen, MembershipStatusScreen } from './auth.js';
import { LoadingState, ErrorState, BottomNav, Sheet, useActiveTab } from './shell.js';
import { EventDetail, eventTitle } from './events.js';
import { HomeTab } from './home.js';
import { CalendarTab } from './calendar.js';
import { RepertoireTab } from './repertoire.js';
import { AdminTab } from './admin.js';
import { MoreTab } from './more.js';
import { CHOIR_NAME, APP_VERSION } from './config.js';

// Home and More are deliberately role-blind: a super sees exactly what an ordinary member sees,
// so Nina can judge the member experience without switching accounts. Organiser controls live on
// the super-only Admin tab, plus inline on Calendar where they're tied to a specific event.
// Repertoire is wired up as of Stage 3 (read-only). Recordings/practice mode/leaderboard/social
// remain later stages and aren't wired up here.
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
  const { membership, profile, error, retry, patchProfile } = useMyMembership(session);

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
  return html`<${Main} session=${session} membership=${membership} profile=${profile} patchProfile=${patchProfile} />`;
}

function Main({ session, membership, profile, patchProfile }) {
  const canManage = isSuper(membership);
  const [tab, setTab] = useActiveTab('home');
  // If a super is demoted while sitting on the Admin tab (role arrives over realtime), fall back
  // rather than leaving them on a screen that no longer belongs to them.
  const activeTab = tab === 'admin' && !canManage ? 'home' : tab;
  // Which Admin screen is open, and optionally which event to edit — set from Calendar's
  // "Manage this event" so an organiser doesn't have to find the event again in a second list.
  const [adminView, setAdminView] = useState(null);
  const manageEvent = (ev) => { setAdminView({ section: 'events', editId: ev.id }); setTab('admin'); };

  // Tapping the tab you're already on used to do nothing — useState bails out on an unchanged
  // value, so a member stuck three screens deep in Repertoire (Practice Mode, a collection, Song
  // Detail…) had no way back except the in-screen back buttons. Nina, 2026-09-15: re-tapping the
  // active tab should jump back to that tab's top level, everywhere in the app.
  //
  // Each tab's own nested navigation (RepertoireTab's detail/practiceOpen/searchOpen, etc.) is
  // local useState inside that component — bumping its `key` forces Preact to remount it fresh,
  // which resets exactly that state without touching the data hooks up here (those live in Main,
  // outside the remounted subtree, so nothing re-fetches or re-subscribes). Admin/More are the
  // two exceptions: their "current view" is lifted up here rather than owned internally, so it's
  // cleared explicitly too.
  const [resetKeys, setResetKeys] = useState({ home: 0, calendar: 0, repertoire: 0, admin: 0, more: 0 });
  const changeTab = (nextTab) => {
    if (nextTab === activeTab) {
      setResetKeys((prev) => ({ ...prev, [nextTab]: prev[nextTab] + 1 }));
      if (nextTab === 'admin') setAdminView(null);
      if (nextTab === 'more') setMoreView(null);
      return;
    }
    setTab(nextTab);
  };
  // ONE event sheet for the whole app, owned here rather than by a tab. Nina's Figma opens an
  // event as a sheet over whatever screen you were on, so Home and Calendar both need it — and
  // this is also where the data it wants (terms, absences, check-ins, leave, the directory)
  // already lives. Keyed by id, not by the row object, so a realtime update to the event while
  // the sheet is open is reflected instead of being frozen at the moment it was tapped.
  const [openEventId, setOpenEventId] = useState(null);
  const [moreView, setMoreView] = useState(null);

  // Events/terms/absences/check-ins load once here rather than per tab: both Home and Calendar need the
  // same rows, useLiveTable names its realtime channel after the table, and switching tabs
  // shouldn't tear down and re-open a subscription (or briefly re-show a loading state).
  const { events, loading: eventsLoading, patchEvent } = useEvents();
  const { terms } = useTerms();
  const { absences, patchAbsence, removeAbsence } = useAbsences();
  const { checkins, patchCheckinRow, removeCheckinRow } = useCheckins();
  const { awayDates, patchAwayDate } = useAwayDates();
  // Used to be super-only ("members don't render anyone else's name"), but Stage 6 needs the
  // directory for every active member — a recording's uploader is shown to whoever can see the
  // recording at all, not just organisers. Always on now.
  const { directory } = useMemberDirectory(true);
  // Repertoire (Stage 3) — fetched here rather than lazily on tab-open, same as everything above.
  const { songs, loading: songsLoading } = useSongs();
  const { collections } = useSongCollections();
  const { collectionItems } = useSongCollectionItems();
  const { assignments, patchAssignment } = useSongAssignments();
  const { rehearsalSongs } = useRehearsalSongs();
  const { partLabels } = usePartLabels();
  const { recordings, patchRecording } = useRecordings();
  const { songLyrics, patchLyricsRow } = useSongLyrics();

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
            aria-label=${`${displayNameOf(profile)} — open More`} onClick=${() => changeTab('more')}>
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
          <${HomeTab} key=${resetKeys.home}
            profile=${profile}
            events=${events} loading=${eventsLoading} terms=${terms}
            absences=${absences} checkins=${checkins}
            onNavigate=${changeTab}
            onOpenEvent=${(ev) => setOpenEventId(ev.id)}
            onCheckinSaved=${patchCheckinRow} onCheckinRemoved=${removeCheckinRow}
            onAbsenceSaved=${patchAbsence} onAbsenceRemoved=${removeAbsence}
          />
        ` : null}
        ${activeTab === 'calendar' ? html`
          <${CalendarTab} key=${resetKeys.calendar}
            profileId=${profile.id}
            events=${events} loading=${eventsLoading} terms=${terms}
            absences=${absences} checkins=${checkins} awayDates=${awayDates}
            onOpenEvent=${(ev) => setOpenEventId(ev.id)}
            onAwayDateSaved=${patchAwayDate}
          />
        ` : null}
        ${activeTab === 'repertoire' ? html`
          <${RepertoireTab} key=${resetKeys.repertoire}
            profile=${profile} canManage=${canManage} songs=${songs} songsLoading=${songsLoading}
            collections=${collections} collectionItems=${collectionItems}
            assignments=${assignments} partLabels=${partLabels}
            events=${events} rehearsalSongs=${rehearsalSongs}
            recordings=${recordings} directory=${directory} songLyrics=${songLyrics}
            onLyricsSaved=${patchLyricsRow}
            onAssignmentSaved=${patchAssignment} onRecordingSaved=${patchRecording}
          />
        ` : null}
        ${activeTab === 'more' ? html`
          <${MoreTab} key=${resetKeys.more} profile=${profile} terms=${terms}
            view=${moreView} setView=${setMoreView}
            onNavigate=${changeTab} onSignOut=${() => supabase.auth.signOut()}
            onProfileSaved=${patchProfile} />
        ` : null}
        ${activeTab === 'admin' && canManage
          ? html`<${AdminTab} key=${resetKeys.admin} session=${session} view=${adminView} setView=${setAdminView}
              events=${events} eventsLoading=${eventsLoading} terms=${terms} onEventSaved=${patchEvent}
              directory=${directory} checkins=${checkins}
              onCheckinSaved=${patchCheckinRow} onCheckinRemoved=${removeCheckinRow} />`
          : null}
      </main>
      <p class="app-footer">${APP_VERSION}</p>
      <${BottomNav} active=${activeTab} onChange=${changeTab} canManage=${canManage} />

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
            onCheckinSaved=${patchCheckinRow} onCheckinRemoved=${removeCheckinRow}
            onAbsenceSaved=${patchAbsence} onAbsenceRemoved=${removeAbsence}
            onManage=${canManage ? (ev) => { setOpenEventId(null); manageEvent(ev); } : null}
          />
        <//>
      ` : null}
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
