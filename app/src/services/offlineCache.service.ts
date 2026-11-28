import AsyncStorage from '@react-native-async-storage/async-storage';

import { NetworkError } from '@/services/api';

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  data: T;
  savedAt: string; // ISO
}

export interface CacheResult<T> {
  data: T;
  fromCache: boolean;
  /** ISO string of when the cache was written; null when fresh from network */
  cachedAt: string | null;
}

/**
 * Try `fetchFn`; on success, persist the result under `key` and return it
 * with `fromCache: false`.  On NetworkError, fall back to the cached entry
 * (if present and < 24 h old) and return it with `fromCache: true`.
 * Any other error (ApiError, auth) propagates normally.
 */
export async function withOfflineCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
): Promise<CacheResult<T>> {
  try {
    const data = await fetchFn();
    const entry: CacheEntry<T> = { data, savedAt: new Date().toISOString() };
    try {
      await AsyncStorage.setItem(key, JSON.stringify(entry));
    } catch {
      // best-effort — cache write failure must not break the successful fetch
    }
    return { data, fromCache: false, cachedAt: null };
  } catch (err) {
    if (!(err instanceof NetworkError)) throw err;

    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const entry = JSON.parse(raw) as CacheEntry<T>;
        const age = Date.now() - new Date(entry.savedAt).getTime();
        if (age <= CACHE_MAX_AGE_MS) {
          return { data: entry.data, fromCache: true, cachedAt: entry.savedAt };
        }
      }
    } catch {
      // corrupted entry — fall through and rethrow the original NetworkError
    }

    throw err;
  }
}

/** Human-readable "guardado hace X" label for the stale-data banner. */
export function formatCacheAge(cachedAt: string): string {
  const diffMs = Date.now() - new Date(cachedAt).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}
