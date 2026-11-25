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
import { Screen } from '@/components/Screen';
import type { MainStackParamList } from '@/navigation/types';
import { Parcela, parcelasService } from '@/services/parcelas.service';
import {
  aggregateParcelas,
  fetchParcelaStats,
  isParcelaStale,
  PARCELA_STALE_DAYS,
  PARCELA_STATS_WINDOW_DAYS,
  ParcelaStats,
} from '@/services/parcelaStats.service';
import type { SigpacReference } from '@/services/sigpac.service';
import { theme } from '@/theme';
import { typography } from '@/typography';

type Props = NativeStackScreenProps<MainStackParamList, 'ParcelasList'>;

/**
 * Tri-state per parcela: undefined (not yet loaded), null (loaded but the
 * fetch failed), or the populated ParcelaStats object. Mirrors the same
 * convention used in FincasListScreen so the rendering is consistent.
 */
type StatsState = ParcelaStats | null;

function formatSigpacRef(ref: SigpacReference | null): string {
  if (!ref) return 'Sin referencia SIGPAC';
  const tail = ref.recinto ? `:${ref.recinto}` : '';
  return `${ref.provincia}:${ref.municipio}:${ref.poligono}:${ref.parcela}${tail}`;
}

function fmtEur(n: number): string {
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} €`;
}

function fmtHa(n: number): string {
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ha`;
}

export function ParcelasListScreen({ route, navigation }: Props): JSX.Element {
  const { fincaId } = route.params;
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [statsByParcela, setStatsByParcela] = useState<
    Map<string, StatsState>
  >(new Map());
  const [statsLoading, setStatsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setParcelas(await parcelasService.listByFinca(fincaId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando parcelas');
    }
  }, [fincaId]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      void load();
    });
    void load().finally(() => setLoading(false));
    return unsub;
  }, [load, navigation]);

  // Stats fan-out: same pattern as FincasListScreen — one parallel
  // `fetchParcelaStats` per parcela, each writes into its own slot so the
  // UI fills in as data arrives instead of blocking on the slowest one.
  // Failures collapse to null and render dashes.
  useEffect(() => {
    if (parcelas.length === 0) {
      setStatsByParcela(new Map());
      setStatsLoading(false);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    setStatsByParcela(new Map());
    let pending = parcelas.length;
    for (const p of parcelas) {
      void fetchParcelaStats(p.id)
        .then((s) => {
          if (cancelled) return;
          setStatsByParcela((prev) => {
            const next = new Map(prev);
            next.set(p.id, s);
            return next;
          });
        })
        .catch(() => {
          if (cancelled) return;
          setStatsByParcela((prev) => {
            const next = new Map(prev);
            next.set(p.id, null);
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
  }, [parcelas]);

  const readyStats = useMemo(() => {
    const m = new Map<string, ParcelaStats>();
    for (const [id, s] of statsByParcela) {
      if (s !== null) m.set(id, s);
    }
    return m;
  }, [statsByParcela]);

  const aggregate = useMemo(
    () => aggregateParcelas(parcelas, readyStats),
    [parcelas, readyStats],
  );

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
        <Text style={styles.title}>Parcelas</Text>
        <Button
          title="Nueva"
          onPress={() => navigation.navigate('CreateParcela', { fincaId })}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {parcelas.length > 0 ? (
        <Card style={styles.aggregate}>
          <View style={styles.aggregateRow}>
            <AggregateCell
              label="Parcelas"
              value={String(aggregate.totalParcelas)}
            />
            <AggregateCell
              label="Superficie"
              value={fmtHa(aggregate.totalAreaHa)}
            />
          </View>
          <View style={styles.aggregateRow}>
            <AggregateCell
              label={`Actividades ${PARCELA_STATS_WINDOW_DAYS}d`}
              value={String(aggregate.totalRecentCount)}
            />
            <AggregateCell
              label={`Coste ${PARCELA_STATS_WINDOW_DAYS}d`}
              value={fmtEur(aggregate.totalRecentCostEur)}
            />
          </View>
          {aggregate.parcelasWithoutArea > 0 ? (
            <Text style={styles.aggregateNote}>
              {aggregate.parcelasWithoutArea} de {aggregate.totalParcelas} sin
              superficie registrada — superficie total parcial
            </Text>
          ) : null}
          {statsLoading ? (
            <Text style={styles.aggregateNote}>Calculando…</Text>
          ) : null}
        </Card>
      ) : null}

      <FlatList
        data={parcelas}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No hay parcelas en esta finca todavía.
          </Text>
        }
        renderItem={({ item }) => {
          const stats = statsByParcela.get(item.id);
          const hasLoaded = statsByParcela.has(item.id);
          // We intentionally only flag stale once the stats load — flagging
          // while loading would briefly mark every parcela as stale and
          // create flicker as data arrives.
          const stale = hasLoaded ? isParcelaStale(stats ?? null) : false;
          return (
            <Card
              onPress={() =>
                navigation.navigate('ParcelaDetail', {
                  parcelaId: item.id,
                  fincaId,
                })
              }
            >
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{item.name}</Text>
                {stale ? (
                  <Text style={styles.staleBadge}>
                    sin actividad {PARCELA_STALE_DAYS}d+
                  </Text>
                ) : null}
              </View>
              <Text style={styles.itemMeta}>
                {formatSigpacRef(item.sigpacRef)} ·{' '}
                {item.areaHa !== null
                  ? fmtHa(item.areaHa)
                  : 'Superficie desconocida'}
              </Text>
              <View style={styles.statsRow}>
                <StatCell
                  label={`Act. ${PARCELA_STATS_WINDOW_DAYS}d`}
                  value={stats ? String(stats.recentCount) : null}
                  loading={!hasLoaded}
                />
                <StatCell
                  label={`Coste ${PARCELA_STATS_WINDOW_DAYS}d`}
                  value={stats ? fmtEur(stats.recentCostEur) : null}
                  loading={!hasLoaded}
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
    </Screen>
  );
}

function AggregateCell({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <View style={styles.aggregateCell}>
      <Text style={styles.aggregateLabel}>{label}</Text>
      <Text style={styles.aggregateValue}>{value}</Text>
    </View>
  );
}

function StatCell({
  label,
  value,
  loading,
  wide,
}: {
  label: string;
  value: string | null;
  loading: boolean;
  wide?: boolean;
}): JSX.Element {
  return (
    <View style={[styles.statCell, wide ? styles.statCellWide : null]}>
      <Text style={styles.statLabel}>{label}</Text>
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.textMuted} />
      ) : (
        <Text style={styles.statValue} numberOfLines={1}>
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
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  title: {
    ...typography.display,
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
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
  staleBadge: {
    ...typography.label,
    color: theme.colors.danger,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
    marginLeft: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    overflow: 'hidden',
  },
  itemMeta: {
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
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
  aggregateNote: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: theme.spacing.xs,
    fontStyle: 'italic',
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
});
