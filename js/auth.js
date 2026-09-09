import { html } from './lib.js';
import { supabase } from './supabaseClient.js';
import { CHOIR_NAME } from './config.js';

// No more shared passphrase — every member signs in with their own Google account. Signing in
// *is* requesting: a database trigger (sonario.handle_new_auth_user) creates a profile + a
// pending membership automatically on first sign-in, so there's no separate "join flow" screen
// here. What screen shows next depends entirely on that membership's status (see Gate below),
// never on anything the client itself claims.
export function SignInScreen() {
  const signIn = () => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  };

  return html`
    <div class="auth-shell">
      <div class="auth-card">
        <h1 class="auth-title">${CHOIR_NAME}</h1>
        <p class="auth-sub">Sign in with Google to request access.</p>
        <button class="btn btn-primary" onClick=${signIn} style=${{ width: '100%' }}>
          Continue with Google
        </button>
      </div>
    </div>
  `;
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
