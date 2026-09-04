# Sonario

A small app for the choir: upcoming rehearsals (with RSVPs and a weekly-slot generator for a
whole term at once), social events (~4/year), the song repertoire (what's learning, what's
performance-ready), and a notice board.

Built the same way as [The Page Turners](../page-turners) — plain HTML/JS, zero build step, zero
npm. Preact + htm loaded via the [esm.sh](https://esm.sh) CDN, Supabase for Postgres + anonymous
auth + realtime sync. Installable as a PWA. $0 to run.

## Set up Supabase

Sonario's tables live in their own `sonario` Postgres schema rather than `public`, specifically
so it can share a Supabase project with another app (e.g. The Page Turners) for free instead of
needing a whole separate project — Supabase's free plan caps how many active projects you can
have. Schemas are fully independent namespaces: a future migration on Page Turners' `books`
table can't touch anything under `sonario.*`, and vice versa. If you'd rather Sonario have its
own dedicated project, that works too — just skip the "share a project" framing below, the SQL
is identical either way.

1. Create a free project at [supabase.com](https://supabase.com) (or reuse an existing one).
2. Dashboard → SQL Editor → New query → paste in [`supabase/schema.sql`](supabase/schema.sql) → Run.
3. Dashboard → Project Settings → API → **Exposed schemas** → add `sonario` alongside `public`.
   Without this step the app's requests will 404 — PostgREST only serves schemas listed here.
4. Dashboard → Authentication → Sign In / Providers → make sure **Anonymous Sign-Ins** is enabled.
5. Dashboard → Project Settings → API → copy the **Project URL** and **anon public** key into
   [`js/config.js`](js/config.js).
6. In the same file, set `MEMBER_PASSPHRASE` and `SUPER_PASSPHRASE` to whatever the choir should
   use. Keep them different from each other — that's what splits regular members from super
   access (scheduling rehearsals, curating the repertoire, pinning/deleting any notice). Both
   ship in the public JS bundle, same "keep randoms out" trust model as any small private app —
   not real security.

## Access model

Everyone signs in with a passphrase + their name (no accounts, no email). Which passphrase you
use decides your role, stored in the session and genuinely enforced by Row Level Security (see
`supabase/schema.sql`), not just hidden UI:

- **Member passphrase** — RSVP to rehearsals and social events, post to the notice board, delete your own notices.
- **Super passphrase** — everything above, plus add/edit/delete rehearsals and social events,
  add/edit/delete songs in the repertoire, and pin or delete *any* notice.

## Run it locally

No build step — just serve the folder and open it:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploy

Push to a GitHub repo and connect it to [Vercel](https://vercel.com) — it auto-deploys on every
push to `main`. No build command needed (static site).

## Project layout

```
index.html            App shell
css/styles.css         All styling
js/config.js            Supabase URL/key + passphrases + version (fill in before use)
js/supabaseClient.js    Supabase client
js/lib.js               Preact/htm imports
js/auth.js               Passphrase sign-in, maps to member/super role
js/store.js              Realtime data hooks (rehearsals, rsvps, social events, songs, notices)
js/app.js                 Tab shell
js/rehearsals.js          Rehearsals tab (schedule + RSVPs + weekly generator)
js/social.js              Social events tab (schedule + RSVPs)
js/repertoire.js          Song repertoire tab
js/noticeboard.js          Notice board tab
supabase/schema.sql        Database schema + RLS policies
manifest.webmanifest, sw.js, icons/   PWA install support
```

See [`TODO.md`](TODO.md) for the current backlog.
