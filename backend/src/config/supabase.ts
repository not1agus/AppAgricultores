import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let serviceClient: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the service role key.
 * Must never be exposed to the frontend.
 */
export function getSupabaseServiceClient(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return serviceClient;
}

/**
 * Per-request client scoped to a user's JWT. Use this when you want
 * Supabase RLS policies to apply on behalf of the caller.
 */
export function getSupabaseUserClient(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
