# TODO

## Before sharing with the choir
- [x] Create/pick the Supabase project and run `supabase/schema.sql` (creates its own `sonario` schema, shares a project with Page Turners)
- [x] Project Settings → API → Exposed schemas → add `sonario`
- [x] Authentication → Providers → enable Anonymous Sign-Ins
- [x] Fill in `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `js/config.js`
- [x] Set real `MEMBER_PASSPHRASE` / `SUPER_PASSPHRASE` values in `js/config.js` (PURPLEHEART / SUPERPURPLEHEART — super shared with Amy, Jo, Sean, Sass, Nina, Gemma)
- [x] Verified end-to-end against the real database: rehearsals, social events, repertoire, notices, RSVPs, and the super/member permission split all confirmed working
- [x] Push to GitHub + connect to Vercel — live at https://sonario-three.vercel.app
- [ ] Swap the placeholder "S" icon for something more Sonario (icons/*)

## Possible next features (not started)
- Attendance history per rehearsal (who actually showed up vs who RSVP'd)
- A "next rehearsal" summary on top of the Rehearsals tab so it doesn't need scrolling
- Sheet music file upload instead of just external links
- Push notifications for new pinned notices
- Per-person super passphrases instead of one shared one (would need a small passphrases table + a server-side check function so raw passphrases are never readable client-side — worth doing if the shared-phrase model ever becomes a real problem, e.g. wanting to revoke just one person's access)
- Paste-in quick-add for rehearsal/event details copied from WhatsApp (manual copy-paste works fine today; this would just save the retyping)
