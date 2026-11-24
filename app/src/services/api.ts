import { env } from '@/config/env';
import {
  mutationQueue,
  OfflineQueuedError,
  QueuedMutation,
  QueueMethod,
} from '@/services/mutationQueue.service';
import { supabase } from '@/services/supabase';

// Shape of every backend response (see backend/src/common/middleware).
type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code?: string } };

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Thrown when fetch() rejects synchronously with a network error
 * (TypeError on RN). Distinct from ApiError (which always carries a
 * server response) so callers can branch on "device offline" vs
 * "server returned 4xx/5xx". */
export class NetworkError extends Error {
  constructor(message = 'Sin conexión') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Caller-provided opt-in for write requests. When the request fails with
 * a network error, instead of throwing NetworkError it enqueues the
 * mutation and throws OfflineQueuedError. Only opt in for non-photo,
 * idempotent-ish operations (creating an actividad, editing a transacción).
 *
 * Photo uploads CANNOT be queued because the local file URI may not
 * survive an app restart on Android. */
interface EnqueueOnOfflineOpt {
  /** Spanish-language label shown in the offline panel. */
  label: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  // URL search params. Undefined values are dropped.
  query?: Record<string, string | number | boolean | undefined>;
  // Override auth for endpoints that don't need it. Default: attach token.
  auth?: boolean;
  signal?: AbortSignal;
  /** Opt into the mutation queue: on network failure, persist the request
   * and surface OfflineQueuedError instead of NetworkError. */
  enqueueOnOffline?: EnqueueOnOfflineOpt;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = env.API_BASE_URL.replace(/\/+$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${base}/api${normalized}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Lower-level wrapper around fetch that normalises errors:
 *   - returns parsed envelope on success
 *   - throws ApiError on a parseable server response (4xx/5xx)
 *   - throws NetworkError when fetch() itself rejected (offline / DNS fail)
 *
 * Shared by `request()` (the user-facing path) and the queue drainer
 * (which needs to distinguish network failure from server rejection in
 * order to decide whether to bail out vs. mark an entry as broken). */
async function rawRequest<T>(
  path: string,
  opts: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  if (opts.auth !== false) {
    const token = await getAccessToken();
    if (!token) {
      throw new ApiError('Not authenticated', 401, 'NOT_AUTHENTICATED');
    }
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    // RN's fetch throws TypeError("Network request failed") when the
    // device is offline or DNS fails. AbortError surfaces here too — let
    // it propagate untouched so callers using AbortController behave as
    // expected.
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new NetworkError(
      err instanceof Error ? err.message : 'Sin conexión',
    );
  }

  if (res.status === 204) return undefined as T;

  let json: Envelope<T>;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(`Upstream returned ${res.status}`, res.status);
  }

  if (!res.ok || !json.success) {
    const err = 'error' in json ? json.error : undefined;
    throw new ApiError(
      err?.message ?? `Request failed (${res.status})`,
      res.status,
      err?.code,
    );
  }
  return json.data;
}

export async function request<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  try {
    const result = await rawRequest<T>(path, opts);
    // Opportunistic drain: any successful request is free evidence that
    // the network is back. Don't await — we don't want to delay the
    // caller's UI just because there's a backlog. Errors during drain
    // are handled internally by mutationQueue.
    void mutationQueue.drain(drainRunner);
    return result;
  } catch (err) {
    // Only enqueue for opted-in writes that genuinely failed for network
    // reasons. ApiError (server replied) is never queued — that's a
    // semantic failure the user must see.
    if (
      err instanceof NetworkError &&
      opts.enqueueOnOffline &&
      opts.method &&
      opts.method !== 'GET'
    ) {
      const entry = await mutationQueue.enqueue({
        method: opts.method as QueueMethod,
        path,
        body: opts.body,
        label: opts.enqueueOnOffline.label,
      });
      throw new OfflineQueuedError(entry);
    }
    throw err;
  }
}

/** Drain runner injected into mutationQueue.drain — replays a single
 * persisted entry and reports back in the (ok | network | server) shape
 * the queue expects. */
async function drainRunner(
  m: QueuedMutation,
): Promise<{ ok: true } | { ok: false; status: number | null; message: string }> {
  try {
    await rawRequest(m.path, {
      method: m.method,
      body: m.body === null ? undefined : m.body,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof NetworkError) {
      return { ok: false, status: null, message: err.message };
    }
    if (err instanceof ApiError) {
      return { ok: false, status: err.status, message: err.message };
    }
    return {
      ok: false,
      status: 500,
      message: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

/** Public hook for the UI's "Sincronizar" button and for app-foreground
 * triggers. Same drainer as the implicit one inside request(). */
export function syncQueueNow(): Promise<{ drained: number; remaining: number }> {
  return mutationQueue.drain(drainRunner);
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']): Promise<T> =>
    request<T>(path, { method: 'GET', query }),
  post: <T>(
    path: string,
    body?: unknown,
    opts?: { enqueueOnOffline?: EnqueueOnOfflineOpt },
  ): Promise<T> =>
    request<T>(path, {
      method: 'POST',
      body,
      ...(opts?.enqueueOnOffline
        ? { enqueueOnOffline: opts.enqueueOnOffline }
        : {}),
    }),
  patch: <T>(
    path: string,
    body?: unknown,
    opts?: { enqueueOnOffline?: EnqueueOnOfflineOpt },
  ): Promise<T> =>
    request<T>(path, {
      method: 'PATCH',
      body,
      ...(opts?.enqueueOnOffline
        ? { enqueueOnOffline: opts.enqueueOnOffline }
        : {}),
    }),
  delete: <T>(
    path: string,
    opts?: { enqueueOnOffline?: EnqueueOnOfflineOpt },
  ): Promise<T> =>
    request<T>(path, {
      method: 'DELETE',
      ...(opts?.enqueueOnOffline
        ? { enqueueOnOffline: opts.enqueueOnOffline }
        : {}),
    }),
};
