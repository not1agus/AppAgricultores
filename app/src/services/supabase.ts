import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/config/env';

// Supabase handles session persistence and refresh itself; we just hand
// it a storage adapter. AsyncStorage is sandboxed per-app on mobile,
// which is enough for the refresh token. If hardware-backed storage is
// required later, swap in a custom adapter here — the rest of the app
// never touches the token directly.
export const supabase: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
