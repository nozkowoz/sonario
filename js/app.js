import { html, render } from './lib.js';
import { supabase } from './supabaseClient.js';
import { useSession, useMyMembership, useAllMemberships, displayNameOf, isSuper } from './store.js';
import { SignInScreen, MembershipStatusScreen } from './auth.js';
import { ApprovalQueue } from './approvals.js';
import { LoadingState, ErrorState, EmptyState, BottomNav, useActiveTab } from './shell.js';
import { CHOIR_NAME, APP_VERSION } from './config.js';

// Checkpoint 4 scope only: app shell (header, bottom nav, loading/empty/error states). Home and
// Calendar are placeholders until Checkpoint 5 builds real event data against them — this shell
// deliberately doesn't pull in repertoire/recordings/leaderboard/social, all still later
// checkpoints.
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
        ${tab === 'home' ? html`<${HomeTab} profile=${profile} canManage=${canManage} />` : null}
        ${tab === 'calendar' ? html`<${CalendarTab} />` : null}
        ${tab === 'more' ? html`<${MoreTab} session=${session} canManage=${canManage} />` : null}
      </main>
      <${BottomNav} active=${tab} onChange=${setTab} />
    </div>
  `;
}

function HomeTab({ profile, canManage }) {
  return html`
    <div class="tab-content">
      <h2>Hi ${displayNameOf(profile) || 'there'}</h2>
      <${EmptyState}
        title="Home is coming together"
        body=${canManage
          ? "Your next rehearsal, quick check-in and admin shortcuts land here in the next build."
          : "Your next rehearsal and quick check-in will show up here shortly."}
      />
    </div>
  `;
}

function CalendarTab() {
  return html`
    <div class="tab-content">
      <h2>Calendar</h2>
      <${EmptyState}
        title="No events yet"
        body="Rehearsals, workshops and performances will appear here once they're scheduled."
      />
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
