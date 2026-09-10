import { html, useState } from './lib.js';
import { displayNameOf, updateDisplayName } from './store.js';
import { currentTermOf } from './events.js';
import { EmptyState } from './shell.js';
import { IconChevron, IconBack } from './icons.js';
import { CHOIR_NAME, APP_VERSION } from './config.js';

// More, per Nina's Figma (PDF p5). Identical for every member, super or not — role-blindness is a
// deliberate rule, so nothing here branches on being an organiser.
//
// TWO DEPARTURES FROM THE MOCKUP, both because the mockup promises data that doesn't exist:
//
//  1. NO VOICE PART under the member's name. The design shows "Soprano · Melbourne City Choir".
//     Nina confirmed twice that a voice part is one per person PER SONG (it lives in
//     `song_assignments`, and migration 0006 enforces one live part per person per song), so
//     there is no profile-level part to print. It could be DERIVED — a member's most-assigned
//     part — but there are no songs yet, so today that query can only ever return nothing.
//     It goes in when Repertoire does. See DESIGN-RULES.md.
//  2. The choir is called Sonario. The mockup's "Melbourne City Choir" was wrong (Nina,
//     2026-09-10), and since the wordmark directly above already says SONARIO, repeating it as a
//     subtitle would just be noise.
//
// "My Availability" NAVIGATES TO CALENDAR rather than carrying its own copy of the leave list.
// Nina asked for logging to stay on Calendar; two screens that both list and cancel leave would
// be two places to keep in step, and the row exists in the design, so it points at the one that
// works.
const SECTIONS = [
  { key: 'profile', label: 'My Profile', body: 'Your name and sign-in email' },
  { key: 'availability', label: 'My Availability', body: 'Log upcoming absences or leave',
    goTo: 'calendar' },
  { key: 'notifications', label: 'Notification Settings', body: 'Control what Sonario sends you',
    soon: true },
  { key: 'help', label: 'Help & Feedback', body: 'Get support or share feedback', soon: true },
  { key: 'about', label: 'About Sonario', body: 'Version and how this app works' },
];

export function MoreTab({ profile, terms, view, setView, onNavigate, onSignOut }) {
  const term = currentTermOf(terms);

  if (view === 'profile') {
    return html`<${MyProfile} profile=${profile} onBack=${() => setView(null)} />`;
  }
  if (view === 'about') {
    return html`<${About} term=${term} onBack=${() => setView(null)} />`;
  }
  if (view) {
    const section = SECTIONS.find((s) => s.key === view);
    return html`
      <div class="tab-content">
        <${MoreHead} title=${section?.label || 'More'} onBack=${() => setView(null)} />
        <${EmptyState} title="Not built yet"
          body=${`${section?.body || ''}. This is on the list rather than a screen waiting to be filled in.`} />
      </div>
    `;
  }

  return html`
    <div class="tab-content">
      <div class="more-top">
        <div class="more-id">
          <span class="more-avatar" aria-hidden="true">
            ${profile.avatar_url
              ? html`<img src=${profile.avatar_url} alt="" referrerpolicy="no-referrer" />`
              : initialOf(profile)}
          </span>
          <p class="more-name">${displayNameOf(profile)}</p>
        </div>
      </div>

      <div class="more-menu">
        ${SECTIONS.map((s) => html`
          <button key=${s.key} class="more-row"
            onClick=${() => (s.goTo ? onNavigate(s.goTo) : setView(s.key))}>
            <span class="more-row-text">
              <span class="more-row-label">
                ${s.label}${s.soon ? html`<span class="admin-soon">Soon</span>` : null}
              </span>
              <span class="more-row-body">${s.body}</span>
            </span>
            <span class="more-row-chev"><${IconChevron} size=${18} /></span>
          </button>
        `)}
      </div>

      <button class="more-signout" onClick=${onSignOut}>Sign out</button>

      <p class="more-version">
        ${CHOIR_NAME} · ${APP_VERSION}${term ? ` · ${term.name}` : ''}
      </p>
    </div>
  `;
}

function MoreHead({ title, onBack }) {
  return html`
    <div class="detail-head">
      <button class="icon-btn" aria-label="Back to More" onClick=${onBack}>
        <${IconBack} size=${20} />
      </button>
      <h2 class="admin-head-title">${title}</h2>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// My Profile. Only the display name is editable, because it's the only thing about a profile a
// member owns: `google_email` comes from the identity provider and `avatar_url` is whatever
// Google returned. The mockup's "contact info" has no column behind it and one was NOT added —
// adding schema to make a mockup render is exactly what Nina asked not to happen.
// ---------------------------------------------------------------------------
function MyProfile({ profile, onBack }) {
  const [name, setName] = useState(displayNameOf(profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const trimmed = name.trim();
  const dirty = trimmed && trimmed !== displayNameOf(profile);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const { data, error: err } = await updateDisplayName(profile.id, trimmed);
    setBusy(false);
    if (err) { setError(err.message); return; }
    // The recurring trap in this app: an UPDATE filtered out by RLS returns no error and no rows.
    // Only a returned row proves the write landed.
    if (!data || data.length === 0) {
      setError("That didn't save — reload and try again.");
      return;
    }
    setSaved(true);
  };

  return html`
    <div class="tab-content">
      <${MoreHead} title="My Profile" onBack=${onBack} />
      <div class="card form-card">
        <label>
          Name
          <input type="text" value=${name} maxlength="80"
            onInput=${(e) => { setName(e.target.value); setSaved(false); }} />
        </label>
        <p class="form-hint">This is the name other members and the organisers see.</p>
        <label>
          Email
          <input type="text" value=${profile.google_email || '—'} disabled />
        </label>
        <p class="form-hint">
          From however you signed in, so it can't be changed here.
        </p>
        ${error ? html`<p class="absence-error">${error}</p>` : null}
        ${saved ? html`<p class="form-saved">Saved.</p>` : null}
        <div class="form-actions">
          <button class="btn btn-primary" disabled=${busy || !dirty} onClick=${save}>
            ${busy ? 'Saving…' : 'Save name'}
          </button>
        </div>
      </div>
      <p class="form-hint">
        Voice parts are set per song rather than on your profile, so they'll appear here once
        Repertoire lands.
      </p>
    </div>
  `;
}

// Deliberately factual. "Version info and legal details" in the mockup would mean writing a
// privacy policy and terms, which this app doesn't have and shouldn't pretend to.
function About({ term, onBack }) {
  return html`
    <div class="tab-content">
      <${MoreHead} title=${`About ${CHOIR_NAME}`} onBack=${onBack} />
      <div class="card">
        <p class="about-line"><strong>Version</strong> ${APP_VERSION}</p>
        ${term ? html`<p class="about-line"><strong>Current term</strong> ${term.name}</p>` : null}
        <p class="about-body">
          ${CHOIR_NAME} keeps the choir's rehearsal schedule, who's coming, and the repertoire in
          one place. It's built and run by the choir, not by a company.
        </p>
        <p class="about-body">
          Add it to your home screen and it works like an app. Your attendance is visible to you
          and to the organisers, and to nobody else.
        </p>
      </div>
    </div>
  `;
}

const initialOf = (profile) => (displayNameOf(profile) || '?').trim()[0].toUpperCase();
