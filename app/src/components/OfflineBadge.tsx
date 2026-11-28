import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { syncQueueNow } from '@/services/api';
import {
  mutationQueue,
  QueuedMutation,
} from '@/services/mutationQueue.service';
import { theme } from '@/theme';

/** Compact banner shown on the home screen and Settings. Renders nothing
 * when the queue is empty so it stays out of the way during normal use.
 *
 * Two visual states:
 *   1. "N pendiente(s) de sincronizar" — sits there waiting; tap "Sincronizar"
 *      to drain on demand.
 *   2. Pulsing while a manual sync is in progress (auto-drain doesn't
 *      surface a spinner because it's silent and runs after every
 *      successful request).
 *
 * Props:
 *   - `compact` (default false): drop the descriptive subtext for use in
 *     dense contexts like a card row.
 *   - `onPressDetail` (optional): if provided, the whole banner is
 *     pressable to drill into a per-entry list (Settings does this). */
interface Props {
  compact?: boolean;
  onPressDetail?: () => void;
}

export function OfflineBadge({ compact, onPressDetail }: Props): JSX.Element | null {
  const [pending, setPending] = useState<QueuedMutation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  useEffect(() => {
    // subscribe() fires immediately with the current snapshot once the
    // AsyncStorage load resolves, so we don't need a separate initial
    // fetch.
    return mutationQueue.subscribe(setPending);
  }, []);

  if (pending.length === 0 && !lastResult) return null;

  async function handleSync(): Promise<void> {
    if (syncing) return;
    setSyncing(true);
    setLastResult(null);
    try {
      const { drained, remaining } = await syncQueueNow();
      if (drained > 0 && remaining === 0) {
        setLastResult(`Sincronizados ${drained} cambio${drained === 1 ? '' : 's'}.`);
      } else if (drained > 0) {
        setLastResult(
          `Sincronizados ${drained}, quedan ${remaining} pendientes.`,
        );
      } else if (remaining > 0) {
        // Nothing went through — most likely still offline. Don't claim
        // success the user didn't get.
        setLastResult('Aún sin conexión.');
      }
    } catch {
      setLastResult('Error al sincronizar.');
    } finally {
      setSyncing(false);
    }
  }

  // Empty queue but with a recent result → flash that result briefly so
  // the user gets confirmation, then disappear. We don't auto-clear here
  // (would need a timer); next mount/unmount handles it. Acceptable
  // tradeoff for v1.
  if (pending.length === 0) {
    return (
      <View style={[styles.wrap, styles.wrapDone]}>
        <Text style={styles.doneText}>{lastResult}</Text>
      </View>
    );
  }

  // The label says how many are blocked vs waiting so the user understands
  // why "Sincronizar" might not clear everything in one tap.
  const blocked = pending.filter((p) => p.attempts >= 5).length;
  const waiting = pending.length - blocked;

  const inner = (
    <View style={styles.row}>
      <View style={styles.dot} />
      <View style={styles.body}>
        <Text style={styles.title}>
          {pending.length} cambio{pending.length === 1 ? '' : 's'} sin sincronizar
        </Text>
        {!compact ? (
          <Text style={styles.sub}>
            {waiting > 0
              ? `${waiting} en espera de conexión`
              : 'Todos los pendientes están bloqueados'}
            {blocked > 0 ? ` · ${blocked} con error` : ''}
          </Text>
        ) : null}
        {lastResult ? <Text style={styles.sub}>{lastResult}</Text> : null}
      </View>
      <Pressable
        onPress={() => void handleSync()}
        disabled={syncing}
        hitSlop={8}
        style={({ pressed }) => [
          styles.syncBtn,
          pressed && !syncing ? styles.syncBtnPressed : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Sincronizar pendientes"
      >
        {syncing ? (
          <ActivityIndicator color={theme.colors.primaryText} size="small" />
        ) : (
          <Text style={styles.syncBtnText}>Sincronizar</Text>
        )}
      </Pressable>
    </View>
  );

  if (onPressDetail) {
    return (
      <Pressable
        onPress={onPressDetail}
        style={({ pressed }) => [
          styles.wrap,
          pressed ? styles.wrapPressed : null,
        ]}
      >
        {inner}
      </Pressable>
    );
  }
  return <View style={styles.wrap}>{inner}</View>;
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#FFF8E6',
    borderColor: '#E5C870',
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  wrapPressed: {
    opacity: 0.85,
  },
  wrapDone: {
    backgroundColor: '#E8F2DD',
    borderColor: theme.colors.primary,
  },
  doneText: {
    color: theme.colors.primary,
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D08A2A',
    marginRight: theme.spacing.sm,
  },
  body: {
    flex: 1,
  },
  title: {
    color: theme.colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  sub: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  syncBtn: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.sm,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
  syncBtnPressed: {
    opacity: 0.85,
  },
  syncBtnText: {
    color: theme.colors.primaryText,
    fontWeight: '700',
    fontSize: 13,
  },
});
