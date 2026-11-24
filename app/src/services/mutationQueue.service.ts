import AsyncStorage from '@react-native-async-storage/async-storage';

// --- Modo offline básico -----------------------------------------------------
// FIFO queue of write requests that failed because the device was offline.
// Persisted to AsyncStorage so it survives app restart. Replayed in order
// when the user taps "Sincronizar" or after any later request succeeds (which
// is a free signal that connectivity is back).
//
// Scope on purpose narrow:
//   * Only the request envelope (method + path + JSON body) is queued —
//     no photo blobs or file URIs (those wouldn't survive a restart on
//     Android, and Storage uploads need the network anyway).
//   * Only the writes the caller explicitly opts into via
//     `api.post(..., { enqueueOnOffline: { label } })` are queued. Random
//     reads while offline still fail loudly.
//   * No server-side idempotency yet: if the request actually reached the
//     server but the response was lost mid-flight, replay creates a
//     duplicate. Documented; will revisit when an idempotency table lands.
//
// State shape kept primitive (plain JSON) so the persisted snapshot is
// version-tolerant: adding fields with defaults is non-breaking.

const STORAGE_KEY = 'app:mutationQueue:v1';

export type QueueMethod = 'POST' | 'PATCH' | 'DELETE';

export interface QueuedMutation {
  id: string;
  /** ISO timestamp when the user originally hit Save. Useful for the UI
   * ("Pendiente desde hace 2 h") and for sorting/displaying. */
  createdAt: string;
  /** Human-readable Spanish label shown in the offline panel. The caller
   * crafts it (e.g. "Crear actividad — Olivar 3"). */
  label: string;
  method: QueueMethod;
  path: string;
  /** JSON body — already a plain object (not stringified). */
  body: unknown;
  /** Number of times we've tried to drain this entry. Caps retry storms
   * if the backend rejects the payload deterministically (e.g. the user
   * was demoted offline and now has FORBIDDEN on every replay). */
  attempts: number;
  /** Last error message from a failed drain attempt, if any. Surfaced in
   * the UI so the user can see *why* their pending op stopped retrying. */
  lastError: string | null;
}

/** Permanent failures that aren't worth retrying — the request reached the
 * server, the server understood it, and refused on the merits. Replaying
 * won't help; the user must edit/cancel manually. We still keep the entry
 * in the queue so it stays visible (vs silently dropping it). */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

/** After this many failed attempts we stop auto-retrying; the entry stays
 * visible but only the user's manual "Reintentar" button will try again. */
const MAX_ATTEMPTS = 5;

type Listener = (snapshot: QueuedMutation[]) => void;

let memory: QueuedMutation[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<Listener>();

function snapshot(): QueuedMutation[] {
  // Defensive copy so subscribers can't mutate internal state.
  return memory.map((m) => ({ ...m }));
}

function notify(): void {
  const snap = snapshot();
  for (const l of listeners) {
    try {
      l(snap);
    } catch {
      // A listener throwing must not break the others or the queue itself.
    }
  }
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Persistence failure is non-fatal — the queue still works in-memory
    // for the current session. Worth surfacing eventually but not in v1.
  }
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          memory = parsed.filter(isQueuedMutation);
        }
      }
    } catch {
      // Corrupt storage → start fresh; better than crashing the app.
      memory = [];
    } finally {
      loaded = true;
      notify();
    }
  })();
  return loadPromise;
}

function isQueuedMutation(v: unknown): v is QueuedMutation {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['id'] === 'string' &&
    typeof o['createdAt'] === 'string' &&
    typeof o['label'] === 'string' &&
    (o['method'] === 'POST' || o['method'] === 'PATCH' || o['method'] === 'DELETE') &&
    typeof o['path'] === 'string' &&
    typeof o['attempts'] === 'number'
  );
}

function genId(): string {
  // Sufficient for client-side queue keys; not security-sensitive.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface EnqueueInput {
  method: QueueMethod;
  path: string;
  body?: unknown;
  label: string;
}

export const mutationQueue = {
  /** Idempotent on listener identity; safe to call multiple times. Returns
   * an unsubscribe. The listener is called immediately with the current
   * snapshot so the UI can render initial state without a race. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    // Fire-and-forget initial load so subscribers (e.g. badge) get a
    // populated snapshot the first time the app starts cold.
    void ensureLoaded().then(() => listener(snapshot()));
    return () => {
      listeners.delete(listener);
    };
  },

  async getAll(): Promise<QueuedMutation[]> {
    await ensureLoaded();
    return snapshot();
  },

  async enqueue(input: EnqueueInput): Promise<QueuedMutation> {
    await ensureLoaded();
    const entry: QueuedMutation = {
      id: genId(),
      createdAt: new Date().toISOString(),
      label: input.label,
      method: input.method,
      path: input.path,
      body: input.body ?? null,
      attempts: 0,
      lastError: null,
    };
    memory.push(entry);
    await persist();
    notify();
    return entry;
  },

  async remove(id: string): Promise<void> {
    await ensureLoaded();
    const before = memory.length;
    memory = memory.filter((m) => m.id !== id);
    if (memory.length !== before) {
      await persist();
      notify();
    }
  },

  async clear(): Promise<void> {
    await ensureLoaded();
    memory = [];
    await persist();
    notify();
  },

  /** Replay all pending entries in FIFO order. Stops at the first network
   * failure (still offline) — keeps remaining entries intact. Permanent
   * failures (4xx) are kept too but their `lastError` is populated.
   *
   * `runRequest` is injected to break the import cycle with `api.ts`
   * (api → queue, but drain needs to call the network → would loop).
   *
   * Returns `{ drained, remaining }` so the UI can decide whether to show
   * a success toast vs a "still pending" notice. */
  async drain(
    runRequest: (
      m: QueuedMutation,
    ) => Promise<{ ok: true } | { ok: false; status: number | null; message: string }>,
  ): Promise<{ drained: number; remaining: number }> {
    await ensureLoaded();
    if (memory.length === 0) return { drained: 0, remaining: 0 };

    let drained = 0;
    // Iterate by id (snapshot of ids) so concurrent enqueue() during drain
    // don't shift indices under us. New entries from concurrent enqueues
    // simply wait for the next drain cycle.
    const ids = memory.map((m) => m.id);
    for (const id of ids) {
      const idx = memory.findIndex((m) => m.id === id);
      if (idx === -1) continue;
      const entry = memory[idx]!;

      // Stop auto-retrying entries that have hit the cap; user must drive
      // them manually via the per-row Retry button (which calls retry()).
      if (entry.attempts >= MAX_ATTEMPTS) continue;

      const result = await runRequest(entry);
      if (result.ok) {
        memory.splice(idx, 1);
        drained++;
        continue;
      }

      // status === null → network error → still offline. No point
      // hammering the rest; bail out and leave the queue intact.
      if (result.status === null) {
        await persist();
        notify();
        return { drained, remaining: memory.length };
      }

      // Server reachable but rejected. Bump attempts + record the reason.
      entry.attempts += 1;
      entry.lastError = result.message;
      // For permanent statuses we lock the attempt count to the cap so
      // auto-drain never tries again — only manual retry will.
      if (PERMANENT_STATUSES.has(result.status)) {
        entry.attempts = MAX_ATTEMPTS;
      }
    }

    await persist();
    notify();
    return { drained, remaining: memory.length };
  },

  /** Reset attempts on a single entry so the next drain() picks it up
   * again. Used by the per-row "Reintentar" button after the user fixed
   * something (e.g. backend was 500ing and is back, or they were
   * temporarily blocked and an admin unblocked them). */
  async retry(id: string): Promise<void> {
    await ensureLoaded();
    const entry = memory.find((m) => m.id === id);
    if (!entry) return;
    entry.attempts = 0;
    entry.lastError = null;
    await persist();
    notify();
  },
};

/** Thrown by `api.request()` when a write was queued instead of executed.
 * Callers (Create/Edit screens) catch this specifically to show
 * "Guardado para sincronizar" rather than a hard error banner. */
export class OfflineQueuedError extends Error {
  public readonly queueEntry: QueuedMutation;
  constructor(queueEntry: QueuedMutation) {
    super('La operación se guardó para sincronizarse cuando vuelva la conexión');
    this.name = 'OfflineQueuedError';
    this.queueEntry = queueEntry;
  }
}
