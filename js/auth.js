import { html, useEffect, useState } from './lib.js';
import { supabase } from './supabaseClient.js';
import { MEMBER_PASSPHRASE, SUPER_PASSPHRASE, CHOIR_NAME } from './config.js';
import { addMember } from './store.js';

// No email, no password — this app is for a small private choir, not a public product. Two
// shared passphrases (a "please don't" speed bump against a random stranger stumbling on the
// URL, not real cryptographic security — both are shipped in this public JS bundle) decide
// whether you sign in as a regular member or with super access. Uses Supabase's anonymous
// sign-in under the hood, with the role stashed in user_metadata so RLS can actually enforce it
// (see supabase/schema.sql), not just hide buttons in the UI.
export function AuthGate() {
  const [phrase, setPhrase] = useState('');
  const [showPhrase, setShowPhrase] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [signing, setSigning] = useState(false);
  const [knownNames, setKnownNames] = useState([]);

  useEffect(() => {
    let cancelled = false;
    supabase.from('members').select('name').order('name').then(({ data, error: fetchError }) => {
      if (cancelled || fetchError || !data) return;
      setKnownNames(data.map((m) => m.name));
    });
    return () => { cancelled = true; };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const trimmedPhrase = phrase.trim();
    let role;
    if (trimmedPhrase === SUPER_PASSPHRASE) role = 'super';
    else if (trimmedPhrase === MEMBER_PASSPHRASE) role = 'member';
    else { setError("That's not quite it — check with the choir."); return; }

    const finalName = name.trim();
    if (!finalName) return;

    setSigning(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInAnonymously();
    if (signInError) { setSigning(false); setError(signInError.message); return; }
    await supabase.auth.updateUser({ data: { display_name: finalName, role } });
    // updateUser() updates the in-memory session's user object immediately (which is why the
    // header shows the right name/role straight away), but the JWT already sitting in this
    // session was minted before that call — it still carries the OLD user_metadata. RLS policies
    // read auth.jwt(), not the in-memory user object, so without a forced refresh here every
    // super-only write gets silently 403'd until the token happens to refresh on its own later.
    await supabase.auth.refreshSession();
    try { await addMember(finalName); } catch (e) {}
    // onAuthStateChange picks up the new session + name/role and moves on to the app.
  };

  return html`
    <div class="auth-shell">
      <div class="auth-card">
        <h1 class="auth-title">${CHOIR_NAME}</h1>
        <p class="auth-sub">Enter the choir passphrase and your name to get in.</p>
        <form onSubmit=${submit} class="auth-form">
          <div style=${{ position: 'relative' }}>
            <input
              type=${showPhrase ? 'text' : 'password'}
              required
              placeholder="Passphrase"
              value=${phrase}
              onInput=${(e) => setPhrase(e.target.value)}
              class="auth-input"
              spellcheck="false"
              autocorrect="off"
              autocapitalize="off"
              style=${{ width: '100%', boxSizing: 'border-box', paddingRight: '54px' }}
            />
            <button type="button" onClick=${() => setShowPhrase(!showPhrase)} class="auth-toggle-visibility">
              ${showPhrase ? 'Hide' : 'Show'}
            </button>
          </div>

          <input
            type="text"
            required
            placeholder="Your name"
            value=${name}
            onInput=${(e) => setName(e.target.value)}
            class="auth-input"
            list="known-names"
          />
          <datalist id="known-names">
            ${knownNames.map((n) => html`<option key=${n} value=${n} />`)}
          </datalist>

          <button type="submit" class="btn btn-primary" disabled=${signing}>${signing ? 'Signing in…' : 'Join'}</button>
          ${error ? html`<div class="auth-error">${error}</div>` : null}
        </form>
      </div>
    </div>
  `;
}
