// Public env values, surfaced via EXPO_PUBLIC_* so Expo inlines them at
// bundle time. No secrets here — the Supabase anon key is safe to ship,
// the service role key never leaves the backend.

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing env var ${name}. Copy app/.env.example to app/.env and fill it in.`,
    );
  }
  return value;
}

export const env = {
  SUPABASE_URL: required(
    'EXPO_PUBLIC_SUPABASE_URL',
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  ),
  SUPABASE_ANON_KEY: required(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
  API_BASE_URL: required(
    'EXPO_PUBLIC_API_BASE_URL',
    process.env.EXPO_PUBLIC_API_BASE_URL,
  ),
};
