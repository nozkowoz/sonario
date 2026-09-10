// Fill these in after creating your Supabase project (see README.md → "Set up Supabase").
// Dashboard → Project Settings → API → "Project URL" and "anon public" key.
// The anon key is safe to ship in client code — it's the public key, and Row Level Security
// (see supabase/schema.sql) is what actually controls who can read or write.
export const SUPABASE_URL = 'https://jpffnazfjxvdzqnfueue.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwZmZuYXpmanh2ZHpxbmZ1ZXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNzA3OTgsImV4cCI6MjEwMzY0Njc5OH0.rXbV13kA4Z_gHmrlcko6yV52td-sckQgL4VZRIUkXYk';

export const CHOIR_NAME = 'Sonario';

// Two shared passphrases, not real security (shipped in this public JS file, same "keep
// randoms out" speed bump as any small-group app) — just a way to tell members and section
// leaders/committee apart. MEMBER_PASSPHRASE gets the regular choir view (RSVP to rehearsals,
// post notices). SUPER_PASSPHRASE additionally unlocks scheduling rehearsals, curating the song
// repertoire, and pinning/deleting any notice — genuinely enforced in the database (see
// supabase/schema.sql), not just hidden buttons. Change both before sharing this with anyone.
export const MEMBER_PASSPHRASE = 'PURPLEHEART';
export const SUPER_PASSPHRASE = 'SUPERPURPLEHEART';

// Shown in the footer so people can check they're on the latest build — useful given the PWA
// caching quirks (see sw.js). Bump this by one on every deploy that ships a real change.
export const APP_VERSION = 'v28-more-profile';
