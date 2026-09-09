import { html, render } from './lib.js';
import { supabase } from './supabaseClient.js';
import { useSession, useMyMembership, useAllMemberships, displayNameOf, isSuper } from './store.js';
import { SignInScreen, MembershipStatusScreen } from './auth.js';
import { ApprovalQueue } from './approvals.js';
import { CHOIR_NAME, APP_VERSION } from './config.js';

// Checkpoint 3 scope only: Google sign-in, membership-state routing, the super approval queue.
// Everything else (Home, Rehearsals, Repertoire, ...) is rebuilt against the new schema starting
// Checkpoint 5 — this shell deliberately doesn't try to render any of the old passphrase-era
// feature components, which no longer match the current tables.
function App() {
  const session = useSession();

  if (session === undefined) {
    return html`<div class="loading-shell">Loading…</div>`;
  }
  if (!session) {
    return html`<${SignInScreen} />`;
  }
  return html`<${Gated} session=${session} />`;
}

function Gated({ session }) {
  const { membership, profile } = useMyMembership(session);

  if (membership === undefined || profile === undefined) {
    return html`<div class="loading-shell">Loading…</div>`;
  }
  if (!membership || membership.status !== 'active') {
    return html`<${MembershipStatusScreen} status=${membership?.status} onSignOut=${() => supabase.auth.signOut()} />`;
  }
  return html`<${Main} session=${session} membership=${membership} profile=${profile} />`;
}

function Main({ session, membership, profile }) {
  const canManage = isSuper(membership);
  const { memberships } = useAllMemberships();

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
        ${canManage
          ? html`<${ApprovalQueue} memberships=${memberships} myProfileId=${session.user.id} />`
          : html`
            <div class="tab-content">
              <h2>You're in!</h2>
              <p class="empty-state">
                Sonario's rebuild is happening one piece at a time — rehearsals, repertoire and
                everything else lands in the next few checkpoints. Check back soon.
              </p>
            </div>
          `}
      </main>
      <footer class="app-footer">${CHOIR_NAME} · ${APP_VERSION}</footer>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('root'));
