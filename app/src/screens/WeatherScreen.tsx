import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Screen } from '@/components/Screen';
import type { MainStackParamList } from '@/navigation/types';
import {
  AemetAlert,
  AlertLevel,
  DailyForecast,
  WeatherAlerts,
  WeatherForecast,
  weatherService,
} from '@/services/weather.service';
import { theme } from '@/theme';
import { typography } from '@/typography';

type Props = NativeStackScreenProps<MainStackParamList, 'Weather'>;

// ─── Cache ────────────────────────────────────────────────────────────────────

const FORECAST_CACHE_PREFIX = 'weather_forecast_v1_';
const ALERTS_CACHE_KEY = 'weather_alerts_v1';
const FORECAST_TTL_MS = 2 * 60 * 60 * 1000; // 2 h
const ALERTS_TTL_MS = 60 * 60 * 1000; // 1 h

interface CacheEntry<T> {
  data: T;
  savedAt: number;
}

async function readCache<T>(key: string, ttl: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.savedAt > ttl) return null;
    return entry.data;
  } catch {
    return null;
  }
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, savedAt: Date.now() };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // best-effort
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function fmtDay(iso: string): { dayName: string; dateStr: string; isToday: boolean } {
  const d = new Date(`${iso}T12:00:00`);
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return {
    dayName: isToday ? 'Hoy' : DAYS_ES[d.getDay()]!,
    dateStr: `${d.getDate()} ${MONTHS_ES[d.getMonth()]}`,
    isToday,
  };
}

const ALERT_STYLES: Record<AlertLevel, { bg: string; border: string; text: string; badge: string }> = {
  amarillo: { bg: '#FFFBEB', border: '#FCD34D', text: '#78350F', badge: '#D97706' },
  naranja:  { bg: '#FFF7ED', border: '#FB923C', text: '#7C2D12', badge: '#EA580C' },
  rojo:     { bg: '#FEF2F2', border: '#FCA5A5', text: '#7F1D1D', badge: '#DC2626' },
};

const LEVEL_LABELS: Record<AlertLevel, string> = {
  amarillo: 'AMARILLO',
  naranja: 'NARANJA',
  rojo: 'ROJO',
};

function fmtAlertDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function AlertBanner({ alert }: { alert: AemetAlert }): JSX.Element {
  const level = alert.level ?? 'amarillo';
  const c = ALERT_STYLES[level];
  return (
    <View style={[styles.alertCard, { backgroundColor: c.bg, borderColor: c.border }]}>
      <View style={styles.alertHeader}>
        <View style={[styles.alertBadge, { backgroundColor: c.badge }]}>
          <Text style={styles.alertBadgeText}>{LEVEL_LABELS[level]}</Text>
        </View>
        {alert.phenomenon ? (
          <Text style={[styles.alertPhenomenon, { color: c.text }]}>
            {alert.phenomenon}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.alertTitle, { color: c.text }]}>{alert.title}</Text>
      <Text style={[styles.alertMeta, { color: c.text }]}>
        {alert.area} · {fmtAlertDate(alert.publishedAt)}
      </Text>
    </View>
  );
}

function DayCard({ day }: { day: DailyForecast }): JSX.Element {
  const { dayName, dateStr, isToday } = fmtDay(day.date);
  return (
    <View style={[styles.dayCard, isToday && styles.dayCardToday]}>
      <View style={styles.dayHeader}>
        <View>
          <Text style={[styles.dayName, isToday && styles.dayNameToday]}>{dayName}</Text>
          <Text style={styles.dayDate}>{dateStr}</Text>
        </View>
        {day.frostRisk ? (
          <View style={styles.frostBadge}>
            <Text style={styles.frostBadgeText}>❄ Helada</Text>
          </View>
        ) : null}
        <Text style={styles.tempBig}>
          {Math.round(day.tempMaxC)}° / {Math.round(day.tempMinC)}°
        </Text>
      </View>
      <View style={styles.dayStats}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Precipitación</Text>
          <Text style={styles.statValue}>{day.precipitationMm.toFixed(1)} mm</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Viento máx.</Text>
          <Text style={styles.statValue}>{Math.round(day.windSpeedMaxKmh)} km/h</Text>
        </View>
        {day.et0Mm !== null ? (
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>ET₀ (evapotrans.)</Text>
            <Text style={styles.statValue}>{day.et0Mm.toFixed(1)} mm</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function WeatherScreen({ route }: Props): JSX.Element {
  const { fincaId, lat, lon } = route.params;

  const [forecast, setForecast] = useState<WeatherForecast | null>(null);
  const [alerts, setAlerts] = useState<AemetAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [alertsFromCache, setAlertsFromCache] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const forecastCacheKey = `${FORECAST_CACHE_PREFIX}${fincaId}`;

  const fetchAll = useCallback(async (force = false): Promise<void> => {
    // Load from cache first on initial load
    if (!force) {
      const [cachedForecast, cachedAlerts] = await Promise.all([
        readCache<WeatherForecast>(forecastCacheKey, FORECAST_TTL_MS),
        readCache<WeatherAlerts>(ALERTS_CACHE_KEY, ALERTS_TTL_MS),
      ]);
      if (cachedForecast) {
        setForecast(cachedForecast);
        setFromCache(true);
      }
      if (cachedAlerts) {
        setAlerts(cachedAlerts.alerts);
        setAlertsFromCache(true);
      }
      if (cachedForecast && cachedAlerts) {
        setLoading(false);
      }
    }

    // Fetch fresh data
    try {
      const [freshForecast, freshAlerts] = await Promise.allSettled([
        weatherService.getForecast(lat, lon),
        weatherService.getAlerts(),
      ]);

      if (freshForecast.status === 'fulfilled') {
        setForecast(freshForecast.value);
        setFromCache(false);
        await writeCache(forecastCacheKey, freshForecast.value);
      }
      if (freshAlerts.status === 'fulfilled') {
        setAlerts(freshAlerts.value.alerts);
        setAlertsFromCache(false);
        await writeCache(ALERTS_CACHE_KEY, freshAlerts.value);
        setFetchedAt(new Date(freshAlerts.value.fetchedAt));
      }
      if (freshForecast.status === 'rejected' && freshAlerts.status === 'rejected') {
        if (!forecast) {
          setError('Sin conexión. Abre la pantalla con wifi para ver el tiempo.');
        }
      }
    } catch {
      // individual errors handled above with allSettled
    }
  }, [fincaId, lat, lon, forecastCacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void fetchAll(false).finally(() => setLoading(false));
  }, [fetchAll]);

  async function onRefresh(): Promise<void> {
    setRefreshing(true);
    try {
      await fetchAll(true);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !forecast) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  if (error && !forecast) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => { setError(null); setLoading(true); void fetchAll(true).finally(() => setLoading(false)); }}>
            <Text style={styles.retryText}>Reintentar</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const redAlerts = alerts.filter((a) => a.level === 'rojo');
  const orangeAlerts = alerts.filter((a) => a.level === 'naranja');
  const yellowAlerts = alerts.filter((a) => a.level === 'amarillo');
  const sortedAlerts = [...redAlerts, ...orangeAlerts, ...yellowAlerts];

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* Alerts section */}
        <Text style={styles.sectionTitle}>Alertas AEMET</Text>
        {sortedAlerts.length === 0 ? (
          <View style={styles.noAlertsCard}>
            <Text style={styles.noAlertsText}>✓ Sin alertas activas</Text>
            {alertsFromCache ? (
              <Text style={styles.cacheNote}>Datos en caché</Text>
            ) : fetchedAt ? (
              <Text style={styles.cacheNote}>
                Actualizado {fmtAlertDate(fetchedAt.toISOString())}
              </Text>
            ) : null}
          </View>
        ) : (
          <>
            {sortedAlerts.map((a) => (
              <AlertBanner key={a.id} alert={a} />
            ))}
            {alertsFromCache ? (
              <Text style={styles.cacheNote}>Alertas en caché · tira para actualizar</Text>
            ) : null}
          </>
        )}

        {/* Forecast section */}
        {forecast && forecast.daily.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Previsión 7 días</Text>
            {fromCache ? (
              <Text style={[styles.cacheNote, styles.cacheNoteTop]}>
                Datos en caché · tira para actualizar
              </Text>
            ) : null}
            {forecast.daily.map((day) => (
              <DayCard key={day.date} day={day} />
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  errorText: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  retryText: {
    color: theme.colors.primary,
    fontWeight: '600',
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  cacheNote: {
    fontSize: 11,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  cacheNoteTop: {
    marginBottom: theme.spacing.xs,
    marginTop: -theme.spacing.xs,
  },

  // Alerts
  noAlertsCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  noAlertsText: {
    color: '#166534',
    fontWeight: '600',
    fontSize: 14,
  },
  alertCard: {
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  alertBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  alertBadgeText: {
    ...typography.label,
    color: '#fff',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  alertPhenomenon: {
    ...typography.headline,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  alertTitle: {
    ...typography.headline,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
    lineHeight: 18,
  },
  alertMeta: {
    ...typography.body,
    fontSize: 11,
    opacity: 0.75,
  },

  // Forecast day cards
  dayCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dayCardToday: {
    borderColor: theme.colors.primary,
    borderWidth: 1.5,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  dayName: {
    ...typography.headline,
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.text,
  },
  dayNameToday: {
    color: theme.colors.primary,
  },
  dayDate: {
    ...typography.body,
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 1,
  },
  tempBig: {
    ...typography.display,
    fontSize: 18,
    fontWeight: '800',
    color: theme.colors.text,
  },
  frostBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 4,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
  },
  frostBadgeText: {
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: '700',
  },
  dayStats: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    flexWrap: 'wrap',
  },
  statItem: {
    minWidth: 80,
  },
  statLabel: {
    ...typography.label,
    fontSize: 11,
    color: theme.colors.textMuted,
    marginBottom: 1,
  },
  statValue: {
    ...typography.bodyMedium,
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.text,
  },
});
