# TODO

## Before sharing with the choir
- [x] Create/pick the Supabase project and run `supabase/schema.sql` (creates its own `sonario` schema, shares a project with Page Turners)
- [x] Project Settings → API → Exposed schemas → add `sonario`
- [x] Authentication → Providers → enable Anonymous Sign-Ins
- [x] Fill in `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `js/config.js`
- [x] Set real `MEMBER_PASSPHRASE` / `SUPER_PASSPHRASE` values in `js/config.js` (PURPLEHEART / SUPERPURPLEHEART — super shared with Amy, Jo, Sean, Sass, Nina, Gemma)
- [x] Verified end-to-end against the real database: rehearsals, social events, repertoire, notices, RSVPs, and the super/member permission split all confirmed working
- [x] Push to GitHub + connect to Vercel — live at https://sonario-choir.vercel.app (renamed from sonario-three.vercel.app, old domain removed not redirected)
- [ ] Swap the placeholder "S" icon for something more Sonario (icons/*)

## In progress
- Rehearsal check-in (3-tier punctuality: green/orange/red) + "Most punctual"/"Best attendance" leaderboards, plus a push-notification layer on top (day-of RSVP reminder, start-time check-in nudge). Full plan: see the "Attendance tracking..." plan from 2026-09-04 in Claude Code's plan history for this project, or ask Claude to re-scope if that's no longer accessible.
- Leadership to confirm: should attendance history/leaderboard be visible to everyone, or admin-only / top-3-only? Currently built as fully visible to everyone (RLS-easy to restrict later if they want it locked down).

## Possible next features (not started)
- Real per-account logins (email-based, magic link or password) instead of shared passphrase + free-text name — raised once check-ins feed a punctuality leaderboard with real stakes (currently nothing stops someone checking in as someone else, or backdating an arrival). A genuinely bigger change than anything else here: swaps out anonymous sign-in, needs a signup/invite flow, and every `member_name text` column would ideally become a real `user_id` foreign key so RLS can enforce "only check in as yourself." Worth its own dedicated scoping pass, not a bolt-on.
- A "next rehearsal" summary on top of the Rehearsals tab so it doesn't need scrolling
- Direct in-app recording uploads (Supabase Storage) instead of the current Sean-airdrops-to-Sean-then-Sean-uploads-to-Drive-then-pastes-a-link flow — removes Sean as the bottleneck. Committed feature (confirmed 2026-09-04) — people record in Voice Memos (~2-3MB per 4min recording, so 35-40/semester ≈ 100MB, well under Supabase's free 1GB tier). Also want a shuffled-by-voice-part practice playlist — doesn't need real audio merging, just an in-app queue/auto-advance player over the uploaded files filtered by part.
- Push notifications for new pinned notices
- Per-person super passphrases instead of one shared one (would need a small passphrases table + a server-side check function so raw passphrases are never readable client-side — worth doing if the shared-phrase model ever becomes a real problem, e.g. wanting to revoke just one person's access)
- Paste-in quick-add for rehearsal/event details copied from WhatsApp (manual copy-paste works fine today; this would just save the retyping)
