import { html, render } from './lib.js';
import { supabase } from './supabaseClient.js';
import {
  useSession, useMyMembership, useAllMemberships, displayNameOf, isSuper,
  useEvents, useTerms, useAbsences, useCheckins, useMemberDirectory,
} from './store.js';
import { SignInScreen, MembershipStatusScreen } from './auth.js';
import { ApprovalQueue } from './approvals.js';
import { LoadingState, ErrorState, EmptyState, BottomNav, useActiveTab } from './shell.js';
import { HomeTab } from './home.js';
import { CalendarTab } from './events.js';
import { CHOIR_NAME, APP_VERSION } from './config.js';

// Steps C+D: Home (next event, absence marking, check-in on the day), Calendar/My Term (full
// event list, admin event management, super attendance view), member absence marking and
// self check-in. Repertoire/recordings/leaderboard/social remain later checkpoints and are
// deliberately not wired up here.
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

  // Events/terms/absences/check-ins load once here rather than per tab: both Home and Calendar need the
  // same rows, useLiveTable names its realtime channel after the table, and switching tabs
  // shouldn't tear down and re-open a subscription (or briefly re-show a loading state).
  const { events, loading: eventsLoading } = useEvents();
  const { terms } = useTerms();
  const { absences } = useAbsences();
  const { checkins } = useCheckins();
  // Only supers ever render another member's name, so members don't call the directory at all.
  const { directory } = useMemberDirectory(canManage);

  return html`
    <div>
      <header class="app-header">
        <div class="app-header-inner">
          <div>
            <h1 class="app-title">${CHOIR_NAME}</h1>
            ${canManage ? html`<p class="app-subtitle">Super access</p>` : null}
          </div>
          <div class="app-user">
            <span>${displayNameOf(profile)}</span>
            <button class="btn-icon" onClick=${() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </header>
      <main class="app-main">
        ${tab === 'home' ? html`
          <${HomeTab}
            profile=${profile} canManage=${canManage}
            events=${events} loading=${eventsLoading} terms=${terms}
            absences=${absences} checkins=${checkins}
            onNavigate=${setTab}
          />
        ` : null}
        ${tab === 'calendar' ? html`
          <${CalendarTab}
            profileId=${profile.id} canManage=${canManage}
            events=${events} loading=${eventsLoading} terms=${terms}
            absences=${absences} checkins=${checkins} directory=${directory}
          />
        ` : null}
        ${tab === 'more' ? html`<${MoreTab} session=${session} canManage=${canManage} />` : null}
      </main>
      <p class="app-footer">${APP_VERSION}</p>
      <${BottomNav} active=${tab} onChange=${setTab} />
    </div>
  `;
}

function MoreTab({ session, canManage }) {
  const { memberships } = useAllMemberships();

  return html`
    <div class="tab-content">
      <h2>More</h2>
      ${canManage
        ? html`<${ApprovalQueue} memberships=${memberships} myProfileId=${session.user.id} />`
        : html`<${EmptyState} title="Nothing here yet" body="Repertoire, recordings and settings land in later builds." />`}
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('root'));
