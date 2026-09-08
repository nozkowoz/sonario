import { html, render, useState } from './lib.js';
import { supabase } from './supabaseClient.js';
import { useSession, displayNameOf, isSuper, useRehearsals, useRsvps, useCheckins, useSocialEvents, useSocialRsvps, useSongs, useNotices } from './store.js';
import { AuthGate } from './auth.js';
import { Rehearsals } from './rehearsals.js';
import { Social } from './social.js';
import { Repertoire } from './repertoire.js';
import { NoticeBoard } from './noticeboard.js';
import { Leaderboard } from './leaderboard.js';
import { CHOIR_NAME, APP_VERSION } from './config.js';

function App() {
  const session = useSession();

  if (session === undefined) {
    return html`<div class="loading-shell">Loading…</div>`;
  }
  if (!session) {
    return html`<${AuthGate} />`;
  }
  return html`<${Main} session=${session} />`;
}

function Main({ session }) {
  const [tab, setTab] = useState('rehearsals');
  const { rehearsals } = useRehearsals();
  const { rsvps } = useRsvps();
  const { checkins } = useCheckins();
  const { socialEvents } = useSocialEvents();
  const { socialRsvps } = useSocialRsvps();
  const { songs } = useSongs();
  const { notices } = useNotices();

  const displayName = displayNameOf(session);
  const canManage = isSuper(session);

  return html`
    <div>
      <header class="app-header">
        <div class="app-header-inner">
          <div>
            <h1 class="app-title">${CHOIR_NAME}</h1>
            ${canManage ? html`<p class="app-subtitle">Super access</p>` : null}
          </div>
          <div class="app-user">
            <span>${displayName}</span>
            <button class="btn-icon" onClick=${() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
        <nav class="tab-row">
          <button class=${'tab-btn' + (tab === 'rehearsals' ? ' active' : '')} onClick=${() => setTab('rehearsals')}>Rehearsals</button>
          <button class=${'tab-btn' + (tab === 'leaderboard' ? ' active' : '')} onClick=${() => setTab('leaderboard')}>Leaderboard</button>
          <button class=${'tab-btn' + (tab === 'social' ? ' active' : '')} onClick=${() => setTab('social')}>Social</button>
          <button class=${'tab-btn' + (tab === 'repertoire' ? ' active' : '')} onClick=${() => setTab('repertoire')}>Repertoire</button>
          <button class=${'tab-btn' + (tab === 'notices' ? ' active' : '')} onClick=${() => setTab('notices')}>Notice board</button>
        </nav>
      </header>
      <main class="app-main">
        ${tab === 'rehearsals'
          ? html`<${Rehearsals} rehearsals=${rehearsals} rsvps=${rsvps} checkins=${checkins} displayName=${displayName} canManage=${canManage} />`
          : tab === 'leaderboard'
          ? html`<${Leaderboard} rehearsals=${rehearsals} checkins=${checkins} />`
          : tab === 'social'
          ? html`<${Social} socialEvents=${socialEvents} socialRsvps=${socialRsvps} displayName=${displayName} canManage=${canManage} />`
          : tab === 'repertoire'
          ? html`<${Repertoire} songs=${songs} canManage=${canManage} />`
          : html`<${NoticeBoard} notices=${notices} displayName=${displayName} canManage=${canManage} />`}
      </main>
      <footer class="app-footer">${CHOIR_NAME} · ${APP_VERSION}</footer>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('root'));
