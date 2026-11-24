import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// ─── Setup ────────────────────────────────────────────────────────────────────

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ─── Storage key for actividadId → notificationId mapping ────────────────────

const STORAGE_KEY = 'notif_map_v1';

async function readMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function writeMap(map: Record<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // best-effort
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Schedule a local notification for the end of a phytosanitary safety period.
 * Fires twice: a 2-day warning and on the actual deadline day.
 * Both are keyed to `actividadId` and can be cancelled together.
 */
export async function scheduleDeadlineNotification(
  actividadId: string,
  productoComercial: string,
  parcelaName: string,
  plazoSeguridadDias: number,
  performedAtIso: string,
): Promise<void> {
  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  const performed = new Date(`${performedAtIso.slice(0, 10)}T08:00:00`);
  const deadline = new Date(performed);
  deadline.setDate(deadline.getDate() + plazoSeguridadDias);

  const now = new Date();
  // Skip scheduling if the deadline is already in the past
  if (deadline <= now) return;

  // Cancel any previous notifications for this activity before rescheduling
  await cancelDeadlineNotification(actividadId);

  const ids: string[] = [];

  // 2-day warning (only if deadline is > 2 days away)
  const warning = new Date(deadline);
  warning.setDate(warning.getDate() - 2);
  if (warning > now) {
    const warnId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `⏰ Plazo de seguridad en 2 días`,
        body: `${productoComercial} en ${parcelaName} — termina el ${deadline.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}`,
        data: { actividadId, type: 'warning' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: warning },
    });
    ids.push(warnId);
  }

  // Deadline day notification
  const deadlineId = await Notifications.scheduleNotificationAsync({
    content: {
      title: `✅ Plazo de seguridad terminado`,
      body: `${productoComercial} en ${parcelaName} — ya puedes cosechar esta parcela`,
      data: { actividadId, type: 'deadline' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: deadline },
  });
  ids.push(deadlineId);

  // Store actividadId → notification IDs (joined by comma)
  const map = await readMap();
  map[actividadId] = ids.join(',');
  await writeMap(map);
}

export async function cancelDeadlineNotification(actividadId: string): Promise<void> {
  const map = await readMap();
  const stored = map[actividadId];
  if (!stored) return;

  for (const id of stored.split(',')) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // already fired or never existed — ignore
    }
  }

  delete map[actividadId];
  await writeMap(map);
}
