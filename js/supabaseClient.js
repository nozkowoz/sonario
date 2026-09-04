import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// db.schema: 'sonario' — this project's tables live in their own Postgres schema (not `public`)
// so this app can safely share a Supabase project with another app. See supabase/schema.sql.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: 'sonario' } });
