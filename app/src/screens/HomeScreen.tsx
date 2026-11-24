import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { OfflineBadge } from '@/components/OfflineBadge';
import { Screen } from '@/components/Screen';
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
          <Button
            title="Ajustes"
            variant="ghost"
            onPress={() => navigation.navigate('Settings')}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <OfflineBadge onPressDetail={() => navigation.navigate('Settings')} />

        {/* Weather alerts — only shown when there are active AEMET alerts */}
        {weatherLoading ? null : weatherAlerts.length > 0 ? (
          <View style={styles.weatherSection}>
            <Text style={styles.weatherTitle}>Alertas meteorológicas</Text>
            {weatherAlerts.map((alert) => (
              <WeatherAlertRow key={alert.id} alert={alert} />
            ))}
          </View>
        ) : null}

        {/* KPI summary card — only when there is at least one finca */}
        {fincas.length > 0 ? (
          <Card style={styles.kpiCard}>
            <View style={styles.kpiRow}>
              <KpiCell label="Fincas" value={String(aggregate.totalFincas)} />
              <KpiCell
                label="Parcelas"
                value={String(aggregate.totalParcelas)}
              />
            </View>
            <View style={styles.kpiRow}>
              <KpiCell
                label="Actividades 30d"
                value={String(aggregate.totalRecentActividades)}
              />
              <KpiCell
                label="Tickets pendientes"
                value={String(aggregate.totalPendingTickets)}
                highlight={aggregate.totalPendingTickets > 0}
              />
            </View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCell}>
                <Text style={styles.kpiLabel}>Parcelas descuidadas</Text>
                {statsLoading ? (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.textMuted}
                    style={styles.kpiSpinner}
                  />
                ) : (
                  <Text
                    style={[
                      styles.kpiValue,
                      aggregate.totalStaleParcelas > 0
                        ? { color: theme.colors.danger }
                        : null,
                    ]}
                  >
                    {String(aggregate.totalStaleParcelas)}
                  </Text>
                )}
              </View>
              <View style={styles.kpiCell}>
                <Text style={styles.kpiLabel}>Balance año en curso</Text>
                {financeAllReported ? (
                  <Text
                    style={[
                      styles.kpiValue,
                      {
                        color:
                          aggregateYtdBalance >= 0
                            ? theme.colors.primary
                            : theme.colors.danger,
                      },
                    ]}
                  >
                    {fmtEur(aggregateYtdBalance)}
                  </Text>
                ) : (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.textMuted}
                    style={styles.kpiSpinner}
                  />
                )}
              </View>
            </View>
            {!statsLoading &&
            aggregate.totalRecentActividades > 0 &&
            aggregate.totalRecentActividadesSinFoto > 0 ? (
              <Text style={styles.kpiNote}>
                {aggregate.totalRecentActividadesSinFoto} de{' '}
                {aggregate.totalRecentActividades} actividades sin foto
              </Text>
            ) : null}
            {statsLoading || financeLoading ? (
              <Text style={styles.kpiNote}>Calculando…</Text>
            ) : null}
          </Card>
        ) : null}

        {/* Pending tickets — alert colour so they are noticed first */}
        {pendingTickets.length > 0 ? (
          <View style={styles.alertSection}>
            <Text style={styles.alertTitle}>
              Tickets pendientes ·{' '}
              {aggregate.totalPendingTickets > PENDING_LIMIT
                ? `${PENDING_LIMIT} de ${aggregate.totalPendingTickets}`
                : aggregate.totalPendingTickets}
            </Text>
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
          </View>
        ) : null}

        {/* Stale parcelas */}
        {staleParcelas.length > 0 ? (
          <View style={styles.alertSection}>
            <Text style={styles.alertTitle}>
              Parcelas descuidadas ·{' '}
              {aggregate.totalStaleParcelas > STALE_LIMIT
                ? `${STALE_LIMIT} de ${aggregate.totalStaleParcelas}`
                : aggregate.totalStaleParcelas}
            </Text>
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
          </View>
        ) : null}

        {/* Recent activity feed — neutral, informational */}
        {recentActividades.length > 0 ? (
          <View style={styles.recentSection}>
            <Text style={styles.recentTitle}>Actividad reciente</Text>
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

        {/* Primary actions */}
        <View style={styles.actions}>
          <Button
            title={
              fincas.length === 0 ? 'Crear primera finca' : 'Gestionar fincas'
            }
            onPress={() => navigation.navigate('FincasList')}
          />
          {fincas.length > 0 ? (
            <Button
              title="Nueva finca"
              variant="ghost"
              onPress={() => navigation.navigate('CreateFinca')}
              style={styles.actionGhost}
            />
          ) : null}
        </View>

        {/* Empty state guidance */}
        {fincas.length === 0 && !loading ? (
          <Text style={styles.emptyHint}>
            Añade tu primera finca para ver el resumen de tu olivar aquí.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// ---------- Sub-components ----------

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
    <Card onPress={onPress} style={styles.rowCard}>
      <View style={styles.row}>
        <View style={styles.rowMain}>
          <Text style={styles.rowPrimary} numberOfLines={1}>
            {fincaName}
            {almazara ? ` · ${almazara}` : ''}
          </Text>
          <Text style={styles.rowMeta}>
            {statusLabel} · {ageLabel(ticket.createdAt)}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </Card>
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
      ? ageLabel(parcela.lastActividadAt)
      : `sin actividad ${PARCELA_STALE_DAYS}d+`;
  return (
    <Card onPress={onPress} style={styles.rowCard}>
      <View style={styles.row}>
        <View style={styles.rowMain}>
          <Text style={styles.rowPrimary} numberOfLines={1}>
            {fincaName} · {parcela.name}
          </Text>
          <Text style={styles.rowMeta}>{age}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </Card>
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
    <Card onPress={onPress} style={styles.rowCard}>
      <View style={styles.row}>
        <View style={styles.rowMain}>
          <Text style={styles.rowPrimary} numberOfLines={1}>
            {ACTIVIDAD_TYPE_LABELS[actividad.type]} · {actividad.parcelaName}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {fincaName} · {cost}
            {ageLabel(actividad.performedAt)}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </Card>
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
    <View style={[styles.weatherRow, { borderLeftColor: color }]}>
      <View style={styles.weatherRowMain}>
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

function KpiCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}): JSX.Element {
  return (
    <View style={styles.kpiCell}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text
        style={[
          styles.kpiValue,
          highlight ? { color: theme.colors.danger } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: theme.spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  headerText: { flex: 1 },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
  },
  userName: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  error: {
    color: theme.colors.danger,
    marginBottom: theme.spacing.md,
  },
  kpiCard: {
    marginBottom: theme.spacing.md,
  },
  kpiRow: {
    flexDirection: 'row',
  },
  kpiCell: {
    flex: 1,
    paddingVertical: theme.spacing.xs,
  },
  kpiLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  kpiValue: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.text,
  },
  kpiSpinner: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  kpiNote: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: theme.spacing.xs,
    fontStyle: 'italic',
  },
  alertSection: {
    marginBottom: theme.spacing.md,
  },
  alertTitle: {
    color: theme.colors.danger,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
    marginBottom: theme.spacing.xs,
  },
  recentSection: {
    marginBottom: theme.spacing.md,
  },
  recentTitle: {
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
    marginBottom: theme.spacing.xs,
  },
  rowCard: {
    marginBottom: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowMain: { flex: 1 },
  rowPrimary: {
    color: theme.colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  rowMeta: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    color: theme.colors.textMuted,
    fontSize: 24,
    marginLeft: theme.spacing.sm,
  },
  actions: {
    marginTop: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  actionGhost: {
    marginTop: theme.spacing.xs,
  },
  emptyHint: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.lg,
    fontSize: 14,
  },
  weatherSection: {
    marginBottom: theme.spacing.md,
  },
  weatherTitle: {
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
    marginBottom: theme.spacing.xs,
  },
  weatherRow: {
    borderLeftWidth: 3,
    paddingLeft: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  weatherRowMain: { flex: 1 },
  weatherLevel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  weatherText: {
    color: theme.colors.text,
    fontSize: 13,
    marginTop: 2,
  },
});
