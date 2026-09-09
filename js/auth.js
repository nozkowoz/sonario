import { html, useState, useEffect } from './lib.js';
import { supabase } from './supabaseClient.js';
import { CHOIR_NAME, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// No more shared passphrase — every member signs in as themselves, and signing in *is*
// requesting: a database trigger (sonario.handle_new_auth_user) creates a profile + a pending
// membership automatically on first sign-in, so there's no separate "join flow" screen here.
// What screen shows next depends entirely on that membership's status (see Gated in app.js),
// never on anything the client itself claims — which is why it doesn't matter to the security
// model *which* method below someone used to prove who they are. Role and status are read from
// `sonario.memberships` either way.

// Which sign-in methods actually exist, asked of the server rather than assumed.
//
// This matters more than it looks. `supabase.auth.signInWithOAuth()` doesn't return an error when
// a provider is switched off — it navigates the whole browser to Supabase's /authorize endpoint,
// which then renders a raw JSON blob at the user
// (`{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not
// enabled"}`). No client-side error handling can catch that, because by then the page is gone. So
// the only way to avoid showing someone that is to not offer the button in the first place.
//
// The upside of asking the server: the moment Google is enabled in the Supabase dashboard, the
// button appears on its own. No code change, no deploy.
function useAuthProviders() {
  const [providers, setProviders] = useState(null); // null = still asking

  useEffect(() => {
    let cancelled = false;
    fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
      .then((r) => r.json())
      .then((s) => { if (!cancelled) setProviders(s?.external || {}); })
      // If this call fails we can't know what's available. Assume email only: it's the method
      // that needs no external console wired up, so it's the safer thing to be wrong about.
      .catch(() => { if (!cancelled) setProviders({ email: true }); });
    return () => { cancelled = true; };
  }, []);

  return providers;
}

export function SignInScreen() {
  const providers = useAuthProviders();
  const [mode, setMode] = useState(null); // null = follow what the server says | choose | email | sent
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const signInWithGoogle = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    // Only reachable if the redirect itself couldn't be started; on success the browser has
    // already navigated away to Google.
    if (err) { setBusy(false); setError(err.message); }
  };

  // Magic link: no password is ever created, so there's none to forget, leak or reset.
  // `data.full_name` is read by the signup trigger to fill in profiles.display_name, and only on
  // first sign-in. It's ordinary user-editable metadata, which is fine — it feeds a display name
  // and nothing else, and never a role.
  const sendLink = async () => {
    const address = email.trim();
    if (!address || !/.+@.+\..+/.test(address)) {
      setError('Enter the email address you want your sign-in link sent to.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo: window.location.origin,
        data: name.trim() ? { full_name: name.trim() } : undefined,
      },
    });
    setBusy(false);
    if (err) {
      // Worth translating: the built-in email service sends only a couple of messages an hour, and
      // "over_email_send_rate_limit" reads like a bug rather than "wait a few minutes".
      setError(/rate limit|too many|429/i.test(err.message)
        ? "That's too many sign-in emails for now — the free email service only sends a couple an hour. Wait a few minutes and try again."
        : err.message);
      return;
    }
    setMode('sent');
  };

  const shell = (children) => html`
    <div class="auth-shell">
      <div class="auth-card">
        <h1 class="auth-title">${CHOIR_NAME}</h1>
        ${children}
      </div>
    </div>
  `;

  if (providers === null) {
    return shell(html`<p class="auth-sub">Loading…</p>`);
  }

  const hasGoogle = !!providers.google;
  const hasEmail = providers.email !== false;
  // With only one method available there's nothing to choose between, so don't make a menu of one.
  const screen = mode || (hasGoogle && hasEmail ? 'choose' : 'email');

  if (screen === 'sent') {
    return shell(html`
      <p class="auth-sub" style=${{ fontWeight: 700, color: 'var(--ink)' }}>Check your email</p>
      <p class="auth-sub">
        We've sent a sign-in link to <strong>${email.trim()}</strong>. Open it on this device and
        you'll be signed straight in — there's no password to remember.
      </p>
      <button class="btn btn-outline" style=${{ width: '100%' }}
        onClick=${() => { setMode('email'); setError(null); }}>
        Use a different address
      </button>
    `);
  }

  if (screen === 'choose') {
    return shell(html`
      <p class="auth-sub">Sign in to request access.</p>
      <button class="btn btn-primary" disabled=${busy} onClick=${signInWithGoogle}
        style=${{ width: '100%' }}>
        ${busy ? 'One moment…' : 'Continue with Google'}
      </button>
      <button class="btn btn-outline" disabled=${busy}
        onClick=${() => { setMode('email'); setError(null); }}
        style=${{ width: '100%', marginTop: '10px' }}>
        Use my email address instead
      </button>
      ${error ? html`<p class="auth-error">${error}</p>` : null}
    `);
  }

  if (!hasEmail) {
    return shell(html`
      <p class="auth-sub">
        Sign-in isn't set up yet. Get in touch with a Sonario organiser — nothing is wrong with
        your account.
      </p>
    `);
  }

  return shell(html`
    <p class="auth-sub">
      Enter your email and we'll send you a link that signs you straight in. No password needed.
    </p>
    <label class="auth-field">
      Your name
      <input type="text" value=${name} onInput=${(e) => setName(e.target.value)}
        placeholder="How the choir knows you" autocomplete="name" />
    </label>
    <label class="auth-field">
      Email
      <input type="email" value=${email} onInput=${(e) => setEmail(e.target.value)}
        placeholder="you@example.com" autocomplete="email" inputmode="email"
        onKeyDown=${(e) => { if (e.key === 'Enter' && !busy) sendLink(); }} />
    </label>
    <button class="btn btn-primary" disabled=${busy} onClick=${sendLink} style=${{ width: '100%' }}>
      ${busy ? 'Sending…' : 'Email me a sign-in link'}
    </button>
    ${hasGoogle ? html`
      <button class="btn-icon" disabled=${busy}
        onClick=${() => { setMode('choose'); setError(null); }} style=${{ marginTop: '12px' }}>
        Back
      </button>
    ` : null}
    ${error ? html`<p class="auth-error">${error}</p>` : null}
  `);
}

// Shown once signed in but not yet an active member — covers pending/declined/deactivated so
// there's one place that reads as "here's where you stand", not a dead end or a confusing error.
export function MembershipStatusScreen({ status, onSignOut }) {
  const copy = {
    pending: {
      heading: "You're nearly in!",
      body: 'Your request has been sent to a Sonario organiser. Check back once someone approves it.',
    },
    declined: {
      heading: "This request wasn't approved",
      body: 'If you think this is a mistake, reach out to a Sonario organiser.',
    },
    deactivated: {
      heading: 'Your access has been deactivated',
      body: 'Contact a Sonario organiser if you have questions.',
    },
  }[status] || {
    heading: 'Something went wrong',
    body: "We couldn't find a membership request for your account. Try signing out and back in, or contact a Sonario organiser.",
  };

  return html`
    <div class="auth-shell">
      <div class="auth-card">
        <h1 class="auth-title">${CHOIR_NAME}</h1>
        <p class="auth-sub" style=${{ fontWeight: 700, color: 'var(--ink)' }}>${copy.heading}</p>
        <p class="auth-sub">${copy.body}</p>
        <button class="btn btn-outline" onClick=${onSignOut} style=${{ width: '100%' }}>Sign out</button>
      </div>
    </div>
  `;
}
