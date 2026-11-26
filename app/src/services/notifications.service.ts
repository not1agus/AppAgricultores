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

// ─── Registro CDE reminder (RD 1311/2012 — 7-day deadline) ───────────────────

const REGISTRO_MAP_KEY = 'notif_registro_map_v1';

async function readRegistroMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(REGISTRO_MAP_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function writeRegistroMap(map: Record<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(REGISTRO_MAP_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Schedule a reminder to register a phytosanitary treatment in the official
 * field notebook. Fires 5 days after the treatment — a 2-day buffer before
 * the 7-day regulatory deadline imposed by RD 1311/2012.
 */
export async function scheduleRegistroReminder(
  actividadId: string,
  parcelaName: string,
  performedAtIso: string,
): Promise<void> {
  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  const performed = new Date(`${performedAtIso.slice(0, 10)}T08:00:00`);
  const fireAt = new Date(performed);
  fireAt.setDate(fireAt.getDate() + 5);

  if (fireAt <= new Date()) return;

  await cancelRegistroReminder(actividadId);

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '📋 Registra el tratamiento fitosanitario',
      body: `${parcelaName} — tienes hasta mañana para anotarlo en el cuaderno oficial (plazo: 7 días)`,
      data: { actividadId, type: 'registro_reminder' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
  });

  const map = await readRegistroMap();
  map[actividadId] = id;
  await writeRegistroMap(map);
}

export async function cancelRegistroReminder(actividadId: string): Promise<void> {
  const map = await readRegistroMap();
  const id = map[actividadId];
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {}
  delete map[actividadId];
  await writeRegistroMap(map);
}

// ─── Campaign reminders ───────────────────────────────────────────────────────

const CAMPANA_MAP_KEY = 'notif_campana_map_v1';

async function readCampanaMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(CAMPANA_MAP_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function writeCampanaMap(map: Record<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(CAMPANA_MAP_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Schedule a start-day notification and (if endDate is set) a 7-day
 * end-warning for a campaign. Cancels any existing reminders for the same
 * campanaId before rescheduling, so it is safe to call on edit.
 */
export async function scheduleCampanaNotifications(
  campanaId: string,
  campanaName: string,
  startDateIso: string,
  endDateIso: string | null,
): Promise<void> {
  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  await cancelCampanaNotifications(campanaId);

  const now = new Date();
  const ids: string[] = [];

  const start = new Date(`${startDateIso}T08:00:00`);
  if (start > now) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `🌿 Campaña "${campanaName}" iniciada`,
        body: 'Empieza a registrar actividades para mantener el cuaderno al día.',
        data: { campanaId, type: 'campana_start' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: start },
    });
    ids.push(id);
  }

  if (endDateIso) {
    const endWarning = new Date(`${endDateIso}T08:00:00`);
    endWarning.setDate(endWarning.getDate() - 7);
    if (endWarning > now) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `📅 Campaña "${campanaName}" termina en 7 días`,
          body: 'Revisa que todas las actividades estén registradas antes del cierre.',
          data: { campanaId, type: 'campana_end_warning' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: endWarning,
        },
      });
      ids.push(id);
    }
  }

  if (ids.length > 0) {
    const map = await readCampanaMap();
    map[campanaId] = ids.join(',');
    await writeCampanaMap(map);
  }
}

export async function cancelCampanaNotifications(campanaId: string): Promise<void> {
  const map = await readCampanaMap();
  const stored = map[campanaId];
  if (!stored) return;
  for (const id of stored.split(',')) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {}
  }
  delete map[campanaId];
  await writeCampanaMap(map);
}
