import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { OfflineBadge } from '@/components/OfflineBadge';
import { Screen } from '@/components/Screen';
import type { MainStackParamList } from '@/navigation/types';
import {
  ACTIVIDAD_TYPE_LABELS,
} from '@/services/actividades.service';
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

type Props = NativeStackScreenProps<MainStackParamList, 'FincasList'>;

/**
 * Per-finca stats are tri-state: undefined (still loading), null (failed —
 * we render "—" rather than blocking the whole dashboard on a single
 * misbehaving finca) or the populated FincaStats object.
 */
type StatsState = FincaStats | null;

/** Same tri-state convention as StatsState but for the finance fan-out. The
 * two fan-outs are kept separate because they pull from different backend
 * endpoints with different failure modes — one going down shouldn't
 * collapse the other. */
type FinanceState = FincaFinanceStats | null;

function fmtEur(n: number): string {
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} €`;
}

const ROL_LABEL: Record<Finca['role'], string> = {
  owner: 'propietario',
  worker: 'trabajador',
};

const HOME_PENDING_LIMIT = 3;
/** Mirrors HOME_PENDING_LIMIT for the stale parcelas section: tight cap so
 * the home stays a glanceable summary, not a scrollable backlog. The
 * full list lives one tap away in the per-finca parcelas list, where the
 * stale badge is also rendered. */
const HOME_STALE_LIMIT = 3;
/** Recent activity feed cap. Slightly larger than the alert sections
 * because this is "what's been happening" — a 5-row stream feels alive
 * without dominating the screen. The full list is one tap away per finca
 * via Cuaderno. */
const HOME_RECENT_LIMIT = 5;

const TICKET_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  processing: 'Procesando',
  failed: 'Error OCR',
  manual: 'Revisión manual',
};

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

function pendingAgeLabel(iso: string): string {
  const d = daysSince(iso);
  if (d === 0) return 'hoy';
  if (d === 1) return 'hace 1 día';
  return `hace ${d} días`;
}

export function FincasListScreen({ navigation }: Props): JSX.Element {
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

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setFincas(await fincasService.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando fincas');
    }
  }, []);

  // Reload on focus so newly created fincas appear without a manual pull.
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      void load();
    });
    void load().finally(() => setLoading(false));
    return unsub;
  }, [load, navigation]);

  // Stats fan-out: every time the finca list changes, kick off one
  // fetchFincaStats per finca in parallel. Each resolves into its own slot
  // so the UI can render each Card's stats as soon as it's ready instead of
  // waiting on the slowest one. Failures collapse to null (rendered as "—").
  useEffect(() => {
    if (fincas.length === 0) {
      setStatsByFinca(new Map());
      setStatsLoading(false);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    // Reset to all-loading so a refresh visibly clears stale numbers.
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

  // Finance fan-out: parallel to the operational stats above, but pulls
  // campaign summaries to compute YTD balance. Independent failure paths so
  // a misbehaving transacciones endpoint doesn't blank out the activity /
  // ticket counters and vice versa. Cost: 1 + N round-trips per finca (list
  // campaigns + summary per campaign), so a user with 3 fincas × 2 active
  // campaigns adds ~9 calls to home load. Acceptable for the typical scale;
  // if it grows replace with a single backend `/dashboard/finance`
  // aggregator.
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

  // Strip the `null` (failed) entries so downstream helpers can assume
  // every value is a populated FincaStats. Done once, reused for both the
  // aggregate and the pending tickets section.
  const readyStats = useMemo(() => {
    const onlyReady = new Map<string, FincaStats>();
    for (const [id, s] of statsByFinca) {
      if (s !== null) onlyReady.set(id, s);
    }
    return onlyReady;
  }, [statsByFinca]);

  const aggregate = useMemo(
    // aggregateStats tolerates partial maps — fincas without stats yet are
    // skipped so the totals climb as data arrives instead of flickering 0.
    () => aggregateStats(fincas, readyStats),
    [fincas, readyStats],
  );

  const pendingTickets = useMemo(
    () => collectPendingTickets(readyStats, HOME_PENDING_LIMIT),
    [readyStats],
  );

  const staleParcelas = useMemo(
    () => collectStaleParcelas(readyStats, HOME_STALE_LIMIT),
    [readyStats],
  );

  const recentActividades = useMemo(
    () => collectRecentActividades(readyStats, HOME_RECENT_LIMIT),
    [readyStats],
  );

  // Per-finca YTD balance (campaigns whose endDate >= Jan 1 of this year).
  // Computed once per finance map change and reused both for the per-card
  // cell and the aggregate sum, so the math is consistent across surfaces.
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

  // True only when every finca has reported (success or failure). Used to
  // gate the aggregate balance display so we don't show a misleadingly
  // small number while half the fincas are still loading.
  const financeAllReported = financeByFinca.size === fincas.length;

  // Resolve fincaId → name once for ticket row labels. The fincas list is
  // already in memory; building the map per render is cheap.
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
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Mis fincas</Text>
          {user ? <Text style={styles.subtitle}>{user.email}</Text> : null}
        </View>
        <Button
          title="Ajustes"
          variant="ghost"
          onPress={() => navigation.navigate('Settings')}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Offline sync indicator. Renders nothing when the queue is empty,
          so it only intrudes when the user actually has pending writes.
          Tapping the banner jumps to Settings where the per-entry list
          and manual retries live. */}
      <OfflineBadge onPressDetail={() => navigation.navigate('Settings')} />

      {fincas.length > 0 ? (
        <Card style={styles.aggregate}>
          <View style={styles.aggregateRow}>
            <AggregateCell label="Fincas" value={String(aggregate.totalFincas)} />
            <AggregateCell
              label="Parcelas"
              value={String(aggregate.totalParcelas)}
            />
          </View>
          <View style={styles.aggregateRow}>
            <AggregateCell
              label="Actividades 30d"
              value={String(aggregate.totalRecentActividades)}
            />
            <AggregateCell
              label="Tickets pendientes"
              value={String(aggregate.totalPendingTickets)}
              highlight={aggregate.totalPendingTickets > 0}
            />
          </View>
          {/* Balance YTD only renders once every finca's finance fan-out
              has reported — partial sums during load could mislead the
              user (a -3.000 € cell that suddenly turns +12.000 € when the
              last finca reports is worse than not showing the number until
              it's stable). The stale-parcelas cell next to it follows the
              same pattern but keyed to the operational stats fan-out. */}
          <View style={styles.aggregateRow}>
            <View style={styles.aggregateCell}>
              <Text style={styles.aggregateLabel}>Parcelas descuidadas</Text>
              {statsLoading ? (
                <ActivityIndicator
                  size="small"
                  color={theme.colors.textMuted}
                  style={styles.aggregateSpinner}
                />
              ) : (
                <Text
                  style={[
                    styles.aggregateValue,
                    aggregate.totalStaleParcelas > 0
                      ? { color: theme.colors.danger }
                      : null,
                  ]}
                >
                  {String(aggregate.totalStaleParcelas)}
                </Text>
              )}
            </View>
            <View style={styles.aggregateCell}>
              <Text style={styles.aggregateLabel}>Balance año en curso</Text>
              {financeAllReported ? (
                <Text
                  style={[
                    styles.aggregateValue,
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
                  style={styles.aggregateSpinner}
                />
              )}
            </View>
          </View>
          {/* Photo coverage hint — informational, not alarming. Only shown
              when there's debt AND there's a denominator > 0, so an empty
              30d window doesn't render a confusing "0 sin foto" line. */}
          {!statsLoading &&
          aggregate.totalRecentActividades > 0 &&
          aggregate.totalRecentActividadesSinFoto > 0 ? (
            <Text style={styles.aggregateNote}>
              {aggregate.totalRecentActividadesSinFoto} de{' '}
              {aggregate.totalRecentActividades} actividades de los últimos 30
              días sin foto
            </Text>
          ) : null}
          {statsLoading || financeLoading ? (
            <Text style={styles.aggregateNote}>Calculando…</Text>
          ) : null}
        </Card>
      ) : null}

      {pendingTickets.length > 0 ? (
        <View style={styles.pendingSection}>
          <Text style={styles.pendingTitle}>
            Tickets pendientes ·{' '}
            {aggregate.totalPendingTickets > HOME_PENDING_LIMIT
              ? `${HOME_PENDING_LIMIT} de ${aggregate.totalPendingTickets}`
              : aggregate.totalPendingTickets}
          </Text>
          {pendingTickets.map((t) => (
            <PendingTicketRow
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

      {staleParcelas.length > 0 ? (
        <View style={styles.pendingSection}>
          <Text style={styles.pendingTitle}>
            Parcelas descuidadas ·{' '}
            {aggregate.totalStaleParcelas > HOME_STALE_LIMIT
              ? `${HOME_STALE_LIMIT} de ${aggregate.totalStaleParcelas}`
              : aggregate.totalStaleParcelas}
          </Text>
          {staleParcelas.map((p) => (
            <StaleParcelaRow
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

      {/* Recent activity feed: deliberately rendered *after* the alert
          sections (tickets, stale parcelas) so urgency-coloured items
          take precedence on first glance. The neutral grey title makes
          this section read as "lo último que pasó" not "atención". */}
      {recentActividades.length > 0 ? (
        <View style={styles.recentSection}>
          <Text style={styles.recentTitle}>Actividad reciente</Text>
          {recentActividades.map((a) => (
            <RecentActividadRow
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

      <FlatList
        data={fincas}
        keyExtractor={(f) => f.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Aún no tienes fincas. Pulsa «Nueva finca» para crear la primera.
          </Text>
        }
        renderItem={({ item }) => {
          // `has(id)` distinguishes "still loading" from "loaded as null
          // (failed)" — both render dashes today but we keep the distinction
          // so we can swap in a retry affordance later without restructuring.
          const stats = statsByFinca.get(item.id);
          const hasLoaded = statsByFinca.has(item.id);
          const finance = financeByFinca.get(item.id);
          const hasFinanceLoaded = financeByFinca.has(item.id);
          const ytdBalance = ytdBalanceByFinca.get(item.id) ?? null;
          // Negative balance is highlighted in red — neutral / positive
          // stay in default text colour. We don't paint positives green at
          // the per-card level to keep visual noise low; the aggregate cell
          // and CampanaDetail already use green for positives.
          const balanceNegative = ytdBalance !== null && ytdBalance < 0;
          return (
            <Card
              onPress={() =>
                navigation.navigate('FincaDetail', {
                  fincaId: item.id,
                  fincaName: item.name,
                })
              }
            >
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{item.name}</Text>
                <Text style={styles.itemRole}>{ROL_LABEL[item.role]}</Text>
              </View>
              <View style={styles.statsRow}>
                <StatCell
                  label="Parcelas"
                  value={stats ? String(stats.parcelasCount) : null}
                  loading={!hasLoaded}
                />
                <StatCell
                  label="Act. 30d"
                  value={stats ? String(stats.recentActividadesCount) : null}
                  loading={!hasLoaded}
                />
                <StatCell
                  label="Pend."
                  value={stats ? String(stats.pendingTicketsCount) : null}
                  loading={!hasLoaded}
                  highlight={!!stats && stats.pendingTicketsCount > 0}
                />
                <StatCell
                  label="Balance año"
                  value={
                    finance && ytdBalance !== null ? fmtEur(ytdBalance) : null
                  }
                  loading={!hasFinanceLoaded}
                  highlight={balanceNegative}
                  wide
                />
                <StatCell
                  label="Última act."
                  value={stats ? (stats.lastActividadAt ?? '—') : null}
                  loading={!hasLoaded}
                  wide
                />
              </View>
            </Card>
          );
        }}
      />

      <Button
        title="Nueva finca"
        onPress={() => navigation.navigate('CreateFinca')}
        style={styles.fab}
      />
    </Screen>
  );
}

function PendingTicketRow({
  ticket,
  fincaName,
  onPress,
}: {
  ticket: Ticket;
  fincaName: string;
  onPress: () => void;
}): JSX.Element {
  // OCR may not have run yet (or may have failed) — fall back gracefully.
  // `corrected` wins over `parsed` because it represents user-confirmed
  // data; the user will recognise their own correction faster than raw OCR.
  const fields = ticket.corrected ?? ticket.parsed;
  const almazara = fields?.almazara?.trim();
  const statusLabel =
    TICKET_STATUS_LABEL[ticket.status] ?? ticket.status;
  return (
    <Card onPress={onPress} style={styles.pendingCard}>
      <View style={styles.pendingRow}>
        <View style={styles.pendingMain}>
          <Text style={styles.pendingPrimary} numberOfLines={1}>
            {fincaName}
            {almazara ? ` · ${almazara}` : ''}
          </Text>
          <Text style={styles.pendingMeta}>
            {statusLabel} · {pendingAgeLabel(ticket.createdAt)}
          </Text>
        </View>
        <Text style={styles.pendingChevron}>›</Text>
      </View>
    </Card>
  );
}

function RecentActividadRow({
  actividad,
  fincaName,
  onPress,
}: {
  actividad: RecentActividadEntry;
  fincaName: string;
  onPress: () => void;
}): JSX.Element {
  // performedAt is YYYY-MM-DD (no time) so daysSince computed via Date
  // construction lands at midnight local. "hoy" therefore means
  // performed today; "hace 1 día" = yesterday. That's the agronomic
  // convention growers use (a "labor de ayer" was done yesterday's
  // calendar day, not 24h ago to the minute).
  const ageLabel = pendingAgeLabel(actividad.performedAt);
  const cost =
    actividad.costEur !== null ? `${fmtEur(actividad.costEur)} · ` : '';
  return (
    <Card onPress={onPress} style={styles.pendingCard}>
      <View style={styles.pendingRow}>
        <View style={styles.pendingMain}>
          <Text style={styles.pendingPrimary} numberOfLines={1}>
            {ACTIVIDAD_TYPE_LABELS[actividad.type]} · {actividad.parcelaName}
          </Text>
          <Text style={styles.pendingMeta} numberOfLines={1}>
            {fincaName} · {cost}{ageLabel}
          </Text>
        </View>
        <Text style={styles.pendingChevron}>›</Text>
      </View>
    </Card>
  );
}

function StaleParcelaRow({
  parcela,
  fincaName,
  onPress,
}: {
  parcela: StaleParcela;
  fincaName: string;
  onPress: () => void;
}): JSX.Element {
  // Today every stale entry comes through with lastActividadAt === null
  // (no activity within the 60d window). The age label keeps the
  // "hace N días" branch ready for when the heuristic widens — until
  // then the wording matches the per-parcela list badge.
  const ageLabel =
    parcela.lastActividadAt !== null
      ? pendingAgeLabel(parcela.lastActividadAt)
      : `sin actividad ${PARCELA_STALE_DAYS}d+`;
  return (
    <Card onPress={onPress} style={styles.pendingCard}>
      <View style={styles.pendingRow}>
        <View style={styles.pendingMain}>
          <Text style={styles.pendingPrimary} numberOfLines={1}>
            {fincaName} · {parcela.name}
          </Text>
          <Text style={styles.pendingMeta}>{ageLabel}</Text>
        </View>
        <Text style={styles.pendingChevron}>›</Text>
      </View>
    </Card>
  );
}

function AggregateCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}): JSX.Element {
  return (
    <View style={styles.aggregateCell}>
      <Text style={styles.aggregateLabel}>{label}</Text>
      <Text
        style={[
          styles.aggregateValue,
          highlight ? { color: theme.colors.danger } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function StatCell({
  label,
  value,
  loading,
  highlight,
  wide,
}: {
  label: string;
  value: string | null;
  loading: boolean;
  highlight?: boolean;
  wide?: boolean;
}): JSX.Element {
  return (
    <View style={[styles.statCell, wide ? styles.statCellWide : null]}>
      <Text style={styles.statLabel}>{label}</Text>
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.textMuted} />
      ) : (
        <Text
          style={[
            styles.statValue,
            highlight ? { color: theme.colors.danger } : null,
          ]}
          numberOfLines={1}
        >
          {value ?? '—'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  title: {
    ...typography.display,
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
  },
  subtitle: {
    ...typography.body,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  separator: { height: theme.spacing.sm },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemTitle: {
    ...typography.headline,
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    flex: 1,
  },
  itemRole: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: theme.spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  statCell: {
    minWidth: 64,
    marginRight: theme.spacing.md,
    marginTop: theme.spacing.xs,
  },
  statCellWide: {
    minWidth: 96,
  },
  statLabel: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statValue: {
    ...typography.bodyMedium,
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  aggregate: {
    marginBottom: theme.spacing.md,
  },
  aggregateRow: {
    flexDirection: 'row',
  },
  aggregateCell: {
    flex: 1,
    paddingVertical: theme.spacing.xs,
  },
  aggregateLabel: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  aggregateValue: {
    ...typography.display,
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text,
  },
  aggregateSpinner: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  aggregateNote: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: theme.spacing.xs,
    fontStyle: 'italic',
  },
  pendingSection: {
    marginBottom: theme.spacing.md,
  },
  pendingTitle: {
    ...typography.label,
    color: theme.colors.danger,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
    marginBottom: theme.spacing.xs,
  },
  // Recent feed shares the row layout (pendingCard/pendingRow/...) but
  // its section title is muted, not red — informational, not alarming.
  recentSection: {
    marginBottom: theme.spacing.md,
  },
  recentTitle: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
    marginBottom: theme.spacing.xs,
  },
  pendingCard: {
    marginBottom: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pendingMain: {
    flex: 1,
  },
  pendingPrimary: {
    color: theme.colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  pendingMeta: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  pendingChevron: {
    color: theme.colors.textMuted,
    fontSize: 24,
    marginLeft: theme.spacing.sm,
  },
  empty: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
  error: {
    color: theme.colors.danger,
    marginBottom: theme.spacing.md,
  },
  fab: {
    marginTop: theme.spacing.md,
  },
});
