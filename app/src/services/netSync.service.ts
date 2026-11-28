import { AppState, AppStateStatus, NativeEventSubscription } from 'react-native';

import { syncQueueNow } from './api';
import { mutationQueue } from './mutationQueue.service';

// Automatic offline-sync triggers:
//
// 1. AppState listener — drains queue when app comes to foreground.
//    Covers the common case: user was offline, closes app, reconnects,
//    reopens app → drain fires within seconds.
//
// 2. Periodic interval (RETRY_INTERVAL_MS) — fires while queue is non-empty.
//    Covers the in-app case: user stays on a screen, connection drops and
//    returns, without navigating or re-foregrounding the app.
//
// The two mechanisms complement the existing "opportunistic drain" in api.ts
// that fires after every successful request. Together they cover all paths
// back to connectivity without requiring @react-native-community/netinfo.

const RETRY_INTERVAL_MS = 30_000;

let appStateSubscription: NativeEventSubscription | null = null;
let queueUnsubscribe: (() => void) | null = null;
let retryInterval: ReturnType<typeof setInterval> | null = null;
let pendingCount = 0;

function maybeSync(): void {
  if (pendingCount === 0) return;
  void syncQueueNow();
}

function onAppStateChange(next: AppStateStatus): void {
  if (next === 'active') {
    maybeSync();
  }
}

function startRetryInterval(): void {
  if (retryInterval !== null) return;
  retryInterval = setInterval(maybeSync, RETRY_INTERVAL_MS);
}

function stopRetryInterval(): void {
  if (retryInterval === null) return;
  clearInterval(retryInterval);
  retryInterval = null;
}

export function startNetSync(): void {
  if (appStateSubscription !== null) return;

  appStateSubscription = AppState.addEventListener('change', onAppStateChange);

  // subscribe() fires immediately with the current snapshot, so pendingCount
  // is populated synchronously before the first maybeSync() call below.
  queueUnsubscribe = mutationQueue.subscribe((entries) => {
    pendingCount = entries.length;
    if (entries.length > 0) {
      startRetryInterval();
    } else {
      stopRetryInterval();
    }
  });

  // Attempt a drain right away in case there were already queued items
  // before the listener was registered (e.g. from a previous session).
  maybeSync();
}

export function stopNetSync(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
  queueUnsubscribe?.();
  queueUnsubscribe = null;
  stopRetryInterval();
  pendingCount = 0;
}
