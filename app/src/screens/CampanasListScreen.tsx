import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import type { MainStackParamList } from '@/navigation/types';
import { Campana, campanasService } from '@/services/campanas.service';
import {
  CampanaSummary,
  transaccionesService,
} from '@/services/transacciones.service';
import { theme } from '@/theme';
import { typography } from '@/typography';

type Props = NativeStackScreenProps<MainStackParamList, 'CampanasList'>;

interface Row {
  campana: Campana;
  summary: CampanaSummary | null;
}

/**
 * Time-based mental-model buckets, derived from start/end dates against
 * today. We deliberately avoid baking a "status" column into the backend:
 * a campaign's bucket changes purely as the calendar advances, not as
 * the user does anything. Computing it client-side keeps the data model
 * simple and the UI accurate even if the device clock crosses midnight
 * mid-session.
 */
type Bucket = 'all' | 'active' | 'upcoming' | 'closed';

const BUCKET_LABEL: Record<Exclude<Bucket, 'all'>, string> = {
  active: 'Activa',
  upcoming: 'Próxima',
  closed: 'Cerrada',
};

/** Display priority when bucket = 'all': what the user most likely wants
 * to look at first. Activas now > about to start > already wrapped. */
const BUCKET_PRIORITY: Record<Exclude<Bucket, 'all'>, number> = {
  active: 0,
  upcoming: 1,
  closed: 2,
};

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function campanaBucket(
  c: Campana,
  today: string,
): Exclude<Bucket, 'all'> {
  if (today < c.startDate) return 'upcoming';
  // An open-ended campaign (no endDate) is never "closed" — it stays
  // active until the grower fills in the end date.
  if (c.endDate !== null && today > c.endDate) return 'closed';
  return 'active';
}

/** 0 decimals on the list/dashboard surfaces — matches FincasListScreen
 * and CampanaDetail's headline cards. The 2-decimal version is reserved
 * for transaction detail rows where the cents matter. */
function fmtEur(n: number): string {
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} €`;
}

interface CampanasStats {
  total: number;
  active: number;
  upcoming: number;
  closed: number;
  /** Sum of balance across campañas for which the summary fetch succeeded.
   * Tracked separately so the UI can flag a partial sum when some
   * summaries failed instead of silently undercounting. */
  totalBalance: number;
  totalBalanceCount: number;
  totalIngresos: number;
  totalGastos: number;
}

function computeStats(rows: Row[], today: string): CampanasStats {
  let active = 0;
  let upcoming = 0;
  let closed = 0;
  let totalBalance = 0;
  let totalBalanceCount = 0;
  let totalIngresos = 0;
  let totalGastos = 0;
  for (const r of rows) {
    const b = campanaBucket(r.campana, today);
    if (b === 'active') active += 1;
    else if (b === 'upcoming') upcoming += 1;
    else closed += 1;
    if (r.summary !== null) {
      totalBalance += r.summary.balance;
      totalIngresos += r.summary.totalIngresos;
      totalGastos += r.summary.totalGastos;
      totalBalanceCount += 1;
    }
  }
  return {
    total: rows.length,
    active,
    upcoming,
    closed,
    totalBalance,
    totalBalanceCount,
    totalIngresos,
    totalGastos,
  };
}

export function CampanasListScreen({ route, navigation }: Props): JSX.Element {
  const { fincaId } = route.params;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const campanas = await campanasService.listByFinca(fincaId);
      // Resolve summaries in parallel; on per-campaña failure keep null so
      // the list still renders the rest. The aggregate card surfaces the
      // partial-sum case.
      const summaries = await Promise.all(
        campanas.map((c) =>
          transaccionesService.summary(c.id).catch(() => null),
        ),
      );
      setRows(
        campanas.map((c, i) => ({ campana: c, summary: summaries[i] ?? null })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando campañas');
    }
  }, [fincaId]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      void load();
    });
    void load().finally(() => setLoading(false));
    return unsub;
  }, [load, navigation]);

  // today is captured once per render. The list won't re-bucket if the
  // user keeps the screen open across midnight, but the next focus event
  // refreshes everything anyway — not worth the timer plumbing.
  const today = useMemo(() => todayIso(), []);

  const stats = useMemo(() => computeStats(rows, today), [rows, today]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (bucket !== 'all' && campanaBucket(r.campana, today) !== bucket) {
        return false;
      }
      if (q.length > 0 && !r.campana.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
    // Sort: when the user has chosen a specific bucket, just startDate
    // desc within it. When showing 'all', interleave by bucket priority
    // (active first, then upcoming, then closed) so the surface answers
    // the implicit "what's relevant now?" before the historical record.
    // id tiebreak keeps the order stable across reloads.
    return [...filtered].sort((a, b) => {
      if (bucket === 'all') {
        const ap = BUCKET_PRIORITY[campanaBucket(a.campana, today)];
        const bp = BUCKET_PRIORITY[campanaBucket(b.campana, today)];
        if (ap !== bp) return ap - bp;
      }
      if (a.campana.startDate > b.campana.startDate) return -1;
      if (a.campana.startDate < b.campana.startDate) return 1;
      return a.campana.id < b.campana.id
        ? -1
        : a.campana.id > b.campana.id
          ? 1
          : 0;
    });
  }, [rows, bucket, search, today]);

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

  // Differentiated empty states so the user knows whether to clear a
  // filter, clear the search, or actually create a campaign — one
  // generic "vacío" message hides which lever to pull.
  const hasFilter = bucket !== 'all' || search.trim().length > 0;
  const emptyText =
    rows.length === 0
      ? 'Aún no hay campañas. Crea una para empezar a registrar transacciones.'
      : search.trim().length > 0 && visible.length === 0
        ? `Ninguna campaña coincide con "${search.trim()}".`
        : hasFilter && visible.length === 0
          ? 'Ninguna campaña coincide con el filtro seleccionado.'
          : '';

  const balancePartial =
    stats.totalBalanceCount > 0 && stats.totalBalanceCount < stats.total;
  const balanceColor =
    stats.totalBalance >= 0 ? theme.colors.primary : theme.colors.danger;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Campañas</Text>
        <Button
          title="Nueva"
          onPress={() => navigation.navigate('CreateCampana', { fincaId })}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {rows.length > 0 ? (
        <Card style={styles.aggregate}>
          <View style={styles.aggregateRow}>
            <AggregateCell label="Total" value={String(stats.total)} />
            <AggregateCell
              label="Activas"
              value={String(stats.active)}
              highlight={stats.active > 0}
            />
            <AggregateCell label="Cerradas" value={String(stats.closed)} />
          </View>
          <View style={styles.aggregateRow}>
            <View style={styles.aggregateCell}>
              <Text style={styles.aggregateLabel}>Balance total</Text>
              {stats.totalBalanceCount === 0 ? (
                <Text style={styles.aggregateValue}>—</Text>
              ) : (
                <Text style={[styles.aggregateValue, { color: balanceColor }]}>
                  {fmtEur(stats.totalBalance)}
                </Text>
              )}
            </View>
            <View style={styles.aggregateCell}>
              <Text style={styles.aggregateLabel}>Ingresos</Text>
              <Text style={styles.aggregateValue}>
                {fmtEur(stats.totalIngresos)}
              </Text>
            </View>
            <View style={styles.aggregateCell}>
              <Text style={styles.aggregateLabel}>Gastos</Text>
              <Text style={styles.aggregateValue}>
                {fmtEur(stats.totalGastos)}
              </Text>
            </View>
          </View>
          {balancePartial ? (
            <Text style={styles.aggregateNote}>
              {stats.total - stats.totalBalanceCount} de {stats.total} sin
              resumen disponible — balance parcial
            </Text>
          ) : null}
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <View style={styles.controls}>
          <View style={styles.searchRow}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar por nombre"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 ? (
              <Pressable
                onPress={() => setSearch('')}
                style={styles.searchClear}
                hitSlop={8}
              >
                <Text style={styles.searchClearText}>×</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.chipRow}>
            <BucketChip
              label={`Todas · ${stats.total}`}
              active={bucket === 'all'}
              onPress={() => setBucket('all')}
            />
            <BucketChip
              label={`Activas · ${stats.active}`}
              active={bucket === 'active'}
              onPress={() => setBucket('active')}
            />
            <BucketChip
              label={`Próximas · ${stats.upcoming}`}
              active={bucket === 'upcoming'}
              onPress={() => setBucket('upcoming')}
            />
            <BucketChip
              label={`Cerradas · ${stats.closed}`}
              active={bucket === 'closed'}
              onPress={() => setBucket('closed')}
            />
          </View>
        </View>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(r) => r.campana.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          emptyText ? <Text style={styles.empty}>{emptyText}</Text> : null
        }
        renderItem={({ item }) => {
          const s = item.summary;
          const balance = s?.balance ?? 0;
          const itemBalanceColor =
            balance >= 0 ? theme.colors.primary : theme.colors.danger;
          const b = campanaBucket(item.campana, today);
          return (
            <Card
              onPress={() =>
                navigation.navigate('CampanaDetail', {
                  campanaId: item.campana.id,
                  campanaName: item.campana.name,
                })
              }
            >
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{item.campana.name}</Text>
                <Text style={[styles.bucketBadge, BUCKET_BADGE_STYLE[b]]}>
                  {BUCKET_LABEL[b]}
                </Text>
              </View>
              <Text style={styles.itemMeta}>
                {item.campana.startDate} → {item.campana.endDate ?? 'en curso'}
              </Text>
              {s ? (
                <View style={styles.balanceRow}>
                  <Text style={styles.balanceLabel}>Balance:</Text>
                  <Text style={[styles.balance, { color: itemBalanceColor }]}>
                    {fmtEur(s.balance)}
                  </Text>
                  <Text style={styles.count}>· {s.count} mov.</Text>
                </View>
              ) : (
                <Text style={styles.itemMeta}>Sin resumen disponible</Text>
              )}
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
          highlight ? { color: theme.colors.primary } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function BucketChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : null]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const BUCKET_BADGE_STYLE: Record<Exclude<Bucket, 'all'>, object> = {
  active: {
    color: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  upcoming: {
    color: theme.colors.text,
    borderColor: theme.colors.textMuted,
  },
  closed: {
    color: theme.colors.textMuted,
    borderColor: theme.colors.textMuted,
  },
};

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
  bucketBadge: {
    ...typography.label,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
    marginLeft: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    overflow: 'hidden',
  },
  itemMeta: {
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  balanceLabel: {
    color: theme.colors.textMuted,
    marginRight: theme.spacing.xs,
  },
  balance: {
    ...typography.headline,
    fontWeight: '700',
    fontSize: 16,
  },
  count: {
    color: theme.colors.textMuted,
    marginLeft: theme.spacing.sm,
    fontSize: 12,
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
  controls: {
    marginBottom: theme.spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    color: theme.colors.text,
    fontSize: 14,
  },
  searchClear: {
    paddingHorizontal: theme.spacing.xs,
  },
  searchClearText: {
    color: theme.colors.textMuted,
    fontSize: 22,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    marginRight: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  chipActive: {
    backgroundColor: theme.colors.primary,
  },
  chipText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: theme.colors.surface,
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
