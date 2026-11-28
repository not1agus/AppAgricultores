import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { IconCircle, IconName } from '@/components/IconCircle';
import { ListRow } from '@/components/ListRow';
import { OfflineBadge } from '@/components/OfflineBadge';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import type { MainStackParamList } from '@/navigation/types';
import { ACTIVIDAD_TYPE_LABELS } from '@/services/actividades.service';
import { AemetAlert, AlertLevel, weatherService } from '@/services/weather.service';
import {
  aggregateStats,
  collectPendingTickets,
  collectRecentActividades,
  collectStaleParcelas,
  fetchFincaStats,
  FincaStats,
  RecentActividadEntry,
  StaleParcela,
} from '@/services/dashboardStats.service';
import {
  fetchFincaFinanceStats,
  filterFinanceStatsYearToDate,
  FincaFinanceStats,
} from '@/services/fincaFinanceStats.service';
import { Finca, fincasService } from '@/services/fincas.service';
import { PARCELA_STALE_DAYS } from '@/services/parcelaStats.service';
import type { Ticket } from '@/services/tickets.service';
import { useAuthStore } from '@/store/useAuthStore';
import { theme } from '@/theme';
import { typography } from '@/typography';

type Props = NativeStackScreenProps<MainStackParamList, 'Home'>;
type StatsState = FincaStats | null;
type FinanceState = FincaFinanceStats | null;

const PENDING_LIMIT = 3;
const STALE_LIMIT = 3;
const RECENT_LIMIT = 5;

const TICKET_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  processing: 'Procesando',
  failed: 'Error OCR',
  manual: 'Revisión manual',
};

function fmtEur(n: number): string {
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} €`;
}

function daysSince(iso: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000),
  );
}

function ageLabel(iso: string): string {
  const d = daysSince(iso);
  if (d === 0) return 'hoy';
  if (d === 1) return 'hace 1 día';
  return `hace ${d} días`;
}

function greet(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export function HomeScreen({ navigation }: Props): JSX.Element {
  const user = useAuthStore((s) => s.user);

  const [fincas, setFincas] = useState<Finca[]>([]);
  const [statsByFinca, setStatsByFinca] = useState<Map<string, StatsState>>(
    new Map(),
  );
  const [financeByFinca, setFinanceByFinca] = useState<
    Map<string, FinanceState>
  >(new Map());
  const [statsLoading, setStatsLoading] = useState(false);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weatherAlerts, setWeatherAlerts] = useState<AemetAlert[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setFincas(await fincasService.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando datos');
    }
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      void load();
    });
    void load().finally(() => setLoading(false));
    return unsub;
  }, [load, navigation]);

  // Weather alerts: loaded once on mount + on each focus. Errors are
  // swallowed silently — a missing forecast is not a blocking failure.
  useEffect(() => {
    const loadAlerts = (): void => {
      setWeatherLoading(true);
      weatherService
        .getAlerts()
        .then((result) => {
          // Only surface rojo/naranja on the home to avoid alert fatigue.
          // Amarillo alerts are informational and can be many in autumn/winter.
          const high = result.alerts.filter(
            (a) => a.level === 'rojo' || a.level === 'naranja',
          );
          setWeatherAlerts(high.length > 0 ? high : result.alerts.slice(0, 3));
        })
        .catch(() => {
          // Network failure — show nothing, don't block the user.
        })
        .finally(() => setWeatherLoading(false));
    };
    const unsub = navigation.addListener('focus', loadAlerts);
    loadAlerts();
    return unsub;
  }, [navigation]);

  // Stats fan-out: one fetchFincaStats per finca in parallel.
  // Each resolves into its own slot so the KPI card updates as data arrives.
  useEffect(() => {
    if (fincas.length === 0) {
      setStatsByFinca(new Map());
      setStatsLoading(false);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    setStatsByFinca(new Map());
    let pending = fincas.length;
    for (const f of fincas) {
      void fetchFincaStats(f.id)
        .then((s) => {
          if (cancelled) return;
          setStatsByFinca((prev) => {
            const next = new Map(prev);
            next.set(f.id, s);
            return next;
          });
        })
        .catch(() => {
          if (cancelled) return;
          setStatsByFinca((prev) => {
            const next = new Map(prev);
            next.set(f.id, null);
            return next;
          });
        })
        .finally(() => {
          if (cancelled) return;
          pending -= 1;
          if (pending === 0) setStatsLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [fincas]);

  // Finance fan-out: independent of stats so a failing transacciones
  // endpoint doesn't blank out the operational counters.
  useEffect(() => {
    if (fincas.length === 0) {
      setFinanceByFinca(new Map());
      setFinanceLoading(false);
      return;
    }
    let cancelled = false;
    setFinanceLoading(true);
    setFinanceByFinca(new Map());
    let pending = fincas.length;
    for (const f of fincas) {
      void fetchFincaFinanceStats(f.id)
        .then((s) => {
          if (cancelled) return;
          setFinanceByFinca((prev) => {
            const next = new Map(prev);
            next.set(f.id, s);
            return next;
          });
        })
        .catch(() => {
          if (cancelled) return;
          setFinanceByFinca((prev) => {
            const next = new Map(prev);
            next.set(f.id, null);
            return next;
          });
        })
        .finally(() => {
          if (cancelled) return;
          pending -= 1;
          if (pending === 0) setFinanceLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [fincas]);

  const readyStats = useMemo(() => {
    const m = new Map<string, FincaStats>();
    for (const [id, s] of statsByFinca) {
      if (s !== null) m.set(id, s);
    }
    return m;
  }, [statsByFinca]);

  const aggregate = useMemo(
    () => aggregateStats(fincas, readyStats),
    [fincas, readyStats],
  );

  const pendingTickets = useMemo(
    () => collectPendingTickets(readyStats, PENDING_LIMIT),
    [readyStats],
  );

  const staleParcelas = useMemo(
    () => collectStaleParcelas(readyStats, STALE_LIMIT),
    [readyStats],
  );

  const recentActividades = useMemo(
    () => collectRecentActividades(readyStats, RECENT_LIMIT),
    [readyStats],
  );

  const ytdBalanceByFinca = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, fin] of financeByFinca) {
      if (fin === null) continue;
      m.set(id, filterFinanceStatsYearToDate(fin).balance);
    }
    return m;
  }, [financeByFinca]);

  const aggregateYtdBalance = useMemo(() => {
    let sum = 0;
    for (const v of ytdBalanceByFinca.values()) sum += v;
    return sum;
  }, [ytdBalanceByFinca]);

  // Only show balance once every finca has reported to avoid a misleadingly
  // partial total (e.g. showing -3.000 € that becomes +12.000 € a second later).
  const financeAllReported = financeByFinca.size === fincas.length;

  const fincaNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fincas) m.set(f.id, f.name);
    return m;
  }, [fincas]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  const attentionCount = pendingTickets.length + staleParcelas.length;

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Greeting header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>{greet()}</Text>
            {user ? (
              <Text style={styles.userName} numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Ajustes"
            hitSlop={8}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Icon name="cog-outline" size={22} color={theme.colors.text} />
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <OfflineBadge onPressDetail={() => navigation.navigate('Settings')} />

        {/* Weather alerts — only shown when there are active AEMET alerts */}
        {weatherLoading ? null : weatherAlerts.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle icon="weather-lightning-rainy" title="Alertas meteorológicas" />
            {weatherAlerts.map((alert) => (
              <WeatherAlertRow key={alert.id} alert={alert} />
            ))}
          </View>
        ) : null}

        {fincas.length > 0 ? (
          <>
            {/* Hero: balance del año */}
            {/* DESIGN.md: CTA/hero gradient primary → primaryContainer at 135°. */}
            <LinearGradient
              colors={[theme.colors.primary, theme.colors.primaryContainer]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.hero}
            >
              <View style={styles.heroTop}>
                <IconCircle name="cash-multiple" tone="onDark" size={36} />
                <Text style={styles.heroLabel}>Balance del año</Text>
              </View>
              {financeAllReported ? (
                <Text
                  style={styles.heroValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {fmtEur(aggregateYtdBalance)}
                </Text>
              ) : (
                <ActivityIndicator
                  color={theme.colors.primaryText}
                  style={styles.heroSpinner}
                />
              )}
              <Text style={styles.heroHint}>
                {aggregateYtdBalance < 0 && financeAllReported
                  ? 'Gastos por encima de ingresos'
                  : 'Ingresos menos gastos, todas las fincas'}
              </Text>
            </LinearGradient>

            {/* KPI grid */}
            <View style={styles.grid}>
              <StatTile icon="home-group" label="Fincas" value={aggregate.totalFincas} />
              <StatTile
                icon="map-marker-radius"
                label="Parcelas"
                value={aggregate.totalParcelas}
                loading={statsLoading}
              />
              <StatTile
                icon="sprout"
                label="Actividades 30 días"
                value={aggregate.totalRecentActividades}
                loading={statsLoading}
              />
              <StatTile
                icon="receipt-text-outline"
                label="Tickets pendientes"
                value={aggregate.totalPendingTickets}
                loading={statsLoading}
                alert={aggregate.totalPendingTickets > 0}
              />
            </View>
            {!statsLoading &&
            aggregate.totalRecentActividades > 0 &&
            aggregate.totalRecentActividadesSinFoto > 0 ? (
              <Text style={styles.note}>
                {aggregate.totalRecentActividadesSinFoto} de{' '}
                {aggregate.totalRecentActividades} actividades sin foto
              </Text>
            ) : null}
          </>
        ) : null}

        {/* Quick actions */}
        <View style={styles.quickRow}>
          <QuickAction
            icon="barn"
            label={fincas.length === 0 ? 'Crear primera finca' : 'Mis fincas'}
            primary
            onPress={() => navigation.navigate('FincasList')}
          />
          {fincas.length > 0 ? (
            <QuickAction
              icon="plus"
              label="Nueva finca"
              onPress={() => navigation.navigate('CreateFinca')}
            />
          ) : null}
        </View>

        {/* Needs attention: pending tickets + stale parcelas */}
        {attentionCount > 0 ? (
          <View style={styles.section}>
            <SectionTitle icon="alert-circle-outline" title="Necesitan atención" tone="danger" />
            {pendingTickets.map((t) => (
              <TicketRow
                key={t.id}
                ticket={t}
                fincaName={fincaNameById.get(t.fincaId) ?? 'Finca'}
                onPress={() =>
                  navigation.navigate('TicketDetail', {
                    ticketId: t.id,
                    fincaId: t.fincaId,
                  })
                }
              />
            ))}
            {aggregate.totalPendingTickets > PENDING_LIMIT ? (
              <Text style={styles.note}>
                Mostrando {PENDING_LIMIT} de {aggregate.totalPendingTickets} tickets pendientes
              </Text>
            ) : null}
            {staleParcelas.map((p) => (
              <StaleRow
                key={p.id}
                parcela={p}
                fincaName={fincaNameById.get(p.fincaId) ?? 'Finca'}
                onPress={() =>
                  navigation.navigate('ParcelaDetail', {
                    parcelaId: p.id,
                    fincaId: p.fincaId,
                  })
                }
              />
            ))}
            {aggregate.totalStaleParcelas > STALE_LIMIT ? (
              <Text style={styles.note}>
                Mostrando {STALE_LIMIT} de {aggregate.totalStaleParcelas} parcelas sin actividad
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Recent activity feed */}
        {recentActividades.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle icon="history" title="Actividad reciente" />
            {recentActividades.map((a) => (
              <ActividadRow
                key={a.id}
                actividad={a}
                fincaName={fincaNameById.get(a.fincaId) ?? 'Finca'}
                onPress={() =>
                  navigation.navigate('ActividadDetail', {
                    actividadId: a.id,
                    fincaId: a.fincaId,
                  })
                }
              />
            ))}
          </View>
        ) : null}

        {statsLoading || financeLoading ? (
          <Text style={[styles.note, styles.noteCenter]}>Calculando…</Text>
        ) : null}

        {/* Empty state guidance */}
        {fincas.length === 0 && !loading ? (
          <View style={styles.empty}>
            <IconCircle name="sprout-outline" size={64} />
            <Text style={styles.emptyHint}>
              Añade tu primera finca para ver el resumen de tu olivar aquí.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// ---------- Sub-components ----------

const ACTIVIDAD_ICONS: Record<string, IconName> = {
  tratamiento_fitosanitario: 'spray',
  riego: 'water',
  poda: 'content-cut',
  cosecha: 'basket',
  abonado: 'sack',
  siembra: 'seed',
  laboreo: 'tractor',
};

function StatTile({
  icon,
  label,
  value,
  loading,
  alert,
}: {
  icon: IconName;
  label: string;
  value: number;
  loading?: boolean;
  alert?: boolean;
}): JSX.Element {
  return (
    <View style={styles.tile}>
      <IconCircle name={icon} tone={alert ? 'danger' : 'primary'} />
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.textMuted} style={styles.tileSpinner} />
      ) : (
        <Text style={[styles.tileValue, alert ? { color: theme.colors.danger } : null]}>
          {String(value)}
        </Text>
      )}
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  primary,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
}): JSX.Element {
  const fg = primary ? theme.colors.primaryText : theme.colors.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.quick,
        primary ? styles.quickPrimary : styles.quickSecondary,
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} size={20} color={fg} />
      <Text style={[styles.quickLabel, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function TicketRow({
  ticket,
  fincaName,
  onPress,
}: {
  ticket: Ticket;
  fincaName: string;
  onPress: () => void;
}): JSX.Element {
  const fields = ticket.corrected ?? ticket.parsed;
  const almazara = fields?.almazara?.trim();
  const statusLabel = TICKET_STATUS_LABEL[ticket.status] ?? ticket.status;
  return (
    <ListRow
      icon="receipt-text-clock-outline"
      tone="danger"
      title={`Ticket · ${fincaName}${almazara ? ` · ${almazara}` : ''}`}
      meta={`${statusLabel} · ${ageLabel(ticket.createdAt)}`}
      onPress={onPress}
    />
  );
}

function StaleRow({
  parcela,
  fincaName,
  onPress,
}: {
  parcela: StaleParcela;
  fincaName: string;
  onPress: () => void;
}): JSX.Element {
  const age =
    parcela.lastActividadAt !== null
      ? `Última actividad ${ageLabel(parcela.lastActividadAt)}`
      : `Sin actividad en ${PARCELA_STALE_DAYS}+ días`;
  return (
    <ListRow
      icon="sprout-outline"
      tone="danger"
      title={`${fincaName} · ${parcela.name}`}
      meta={age}
      onPress={onPress}
    />
  );
}

function ActividadRow({
  actividad,
  fincaName,
  onPress,
}: {
  actividad: RecentActividadEntry;
  fincaName: string;
  onPress: () => void;
}): JSX.Element {
  const cost =
    actividad.costEur !== null ? `${fmtEur(actividad.costEur)} · ` : '';
  return (
    <ListRow
      icon={ACTIVIDAD_ICONS[actividad.type] ?? 'clipboard-text-outline'}
      title={`${ACTIVIDAD_TYPE_LABELS[actividad.type]} · ${actividad.parcelaName}`}
      meta={`${fincaName} · ${cost}${ageLabel(actividad.performedAt)}`}
      onPress={onPress}
    />
  );
}

const ALERT_COLORS: Record<AlertLevel, string> = {
  rojo: '#c0392b',
  naranja: '#d35400',
  amarillo: '#d4ac0d',
};

function WeatherAlertRow({ alert }: { alert: AemetAlert }): JSX.Element {
  const color = alert.level ? ALERT_COLORS[alert.level] : theme.colors.textMuted;
  const levelLabel = alert.level
    ? alert.level.charAt(0).toUpperCase() + alert.level.slice(1)
    : 'Aviso';
  return (
    <View style={styles.weatherRow}>
      <Icon name={alert.level ? 'alert' : 'alert-circle-outline'} size={22} color={color} />
      <View style={styles.rowMain}>
        <Text style={[styles.weatherLevel, { color }]}>{levelLabel}</Text>
        <Text style={styles.weatherText} numberOfLines={2}>
          {alert.phenomenon
            ? `${alert.phenomenon.charAt(0).toUpperCase() + alert.phenomenon.slice(1)}${alert.area ? ` · ${alert.area}` : ''}`
            : alert.title}
        </Text>
      </View>
    </View>
  );
}

// ---------- Styles ----------

// Tonal tints for icon circles (DESIGN.md: depth through color, not lines).
const PRIMARY_SOFT = 'rgba(62, 82, 25, 0.10)';

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noteCenter: { textAlign: 'center' },
  scroll: { paddingBottom: theme.spacing.xl },
  pressed: { opacity: 0.75 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  headerText: { flex: 1 },
  greeting: {
    ...typography.display,
    fontSize: 28,
    color: theme.colors.text,
  },
  userName: {
    ...typography.body,
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: theme.colors.danger,
    marginBottom: theme.spacing.md,
  },

  hero: {
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  heroLabel: {
    ...typography.label,
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 14,
  },
  heroValue: {
    ...typography.display,
    color: theme.colors.primaryText,
    fontSize: 40,
    marginTop: theme.spacing.md,
  },
  heroSpinner: { alignSelf: 'flex-start', marginTop: theme.spacing.md, height: 48 },
  heroHint: {
    ...typography.body,
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 12,
    marginTop: theme.spacing.xs,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  tileValue: {
    ...typography.display,
    fontSize: 28,
    color: theme.colors.text,
    marginTop: theme.spacing.sm,
  },
  tileSpinner: { alignSelf: 'flex-start', marginTop: theme.spacing.sm, height: 34 },
  tileLabel: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  note: {
    ...typography.body,
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: theme.spacing.sm,
  },

  quickRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  quick: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
  },
  quickPrimary: { backgroundColor: theme.colors.primary },
  quickSecondary: { backgroundColor: PRIMARY_SOFT },
  quickLabel: {
    ...typography.headline,
    fontSize: 15,
  },

  section: { marginBottom: theme.spacing.lg },
  rowMain: { flex: 1, minWidth: 0 },

  weatherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceLow,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  weatherLevel: {
    ...typography.label,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  weatherText: {
    ...typography.body,
    color: theme.colors.text,
    fontSize: 13,
    marginTop: 2,
  },

  empty: { alignItems: 'center', marginTop: theme.spacing.lg },
  emptyHint: {
    ...typography.body,
    color: theme.colors.textMuted,
    textAlign: 'center',
    fontSize: 14,
    marginTop: theme.spacing.md,
  },
});
