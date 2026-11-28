import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
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
import { cancelCampanaNotifications } from '@/services/notifications.service';
import {
  CampanaSummary,
  Transaccion,
  TransaccionKind,
  transaccionesService,
} from '@/services/transacciones.service';
import { exportTransaccionesCsv } from '@/services/transaccionesExport.service';
import { theme } from '@/theme';
import { typography } from '@/typography';
import { confirmDestructive } from '@/utils/confirm';

type Props = NativeStackScreenProps<MainStackParamList, 'CampanaDetail'>;

function fmtEur(n: number): string {
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

type PeriodPreset = 'all' | 'month' | 'last30' | 'last90';

const PERIOD_LABELS: Record<PeriodPreset, string> = {
  all: 'Todo',
  month: 'Mes en curso',
  last30: 'Últimos 30 días',
  last90: 'Últimos 90 días',
};

const PERIOD_PRESETS: PeriodPreset[] = ['all', 'month', 'last30', 'last90'];

type SortPreset = 'date_desc' | 'date_asc' | 'amount_desc';

const SORT_LABELS: Record<SortPreset, string> = {
  date_desc: 'Recientes',
  date_asc: 'Antiguos',
  amount_desc: 'Mayor importe',
};

const SORT_PRESETS: SortPreset[] = ['date_desc', 'date_asc', 'amount_desc'];

/**
 * Sort comparator factory. Returns a stable order — when the primary key
 * ties (same date or same amount) we fall back to id so the list doesn't
 * shuffle on re-render. Important when the user is mid-scroll and a refresh
 * fires.
 */
function sortComparator(
  preset: SortPreset,
): (a: Transaccion, b: Transaccion) => number {
  if (preset === 'date_asc') {
    return (a, b) => {
      if (a.occurredAt !== b.occurredAt)
        return a.occurredAt < b.occurredAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    };
  }
  if (preset === 'amount_desc') {
    return (a, b) => {
      if (a.amountEur !== b.amountEur) return b.amountEur - a.amountEur;
      return a.id < b.id ? -1 : 1;
    };
  }
  // date_desc (default)
  return (a, b) => {
    if (a.occurredAt !== b.occurredAt)
      return a.occurredAt > b.occurredAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  };
}

function toIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Period bounds are computed against today (not against campana.startDate).
 * For closed/historical campañas the relative presets simply return empty —
 * that's the intended signal ("no movement in last 30 days because the
 * campaign closed last year"). Avoids cluttering the chip row with dynamic
 * per-month options for long campaigns.
 */
function resolvePeriod(preset: PeriodPreset): {
  from?: string;
  to?: string;
} {
  if (preset === 'all') return {};
  const now = new Date();
  if (preset === 'month') {
    return {
      from: toIso(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: toIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
  }
  if (preset === 'last30') {
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    return { from: toIso(from), to: toIso(now) };
  }
  // last90
  const from = new Date(now);
  from.setDate(from.getDate() - 90);
  return { from: toIso(from), to: toIso(now) };
}

/**
 * Recompute totals over a filtered slice. The backend `summary` endpoint
 * still gives the canonical campaign-wide totals; this is purely for the
 * sub-period view so the user can answer "how much did I spend this month?"
 * without leaving the screen.
 */
function summarizeLocal(
  campanaId: string,
  list: Transaccion[],
): CampanaSummary {
  let totalIngresos = 0;
  let totalGastos = 0;
  for (const t of list) {
    if (t.kind === 'ingreso') totalIngresos += t.amountEur;
    else totalGastos += t.amountEur;
  }
  return {
    campanaId,
    totalIngresos,
    totalGastos,
    balance: totalIngresos - totalGastos,
    count: list.length,
  };
}

interface CategoryBucket {
  key: string;
  kind: TransaccionKind;
  category: string;
  count: number;
  total: number;
  /** 0..1, share of `total` over the largest bucket of the same kind. */
  share: number;
}

/**
 * Group transactions by `kind:category` so the same category name appearing
 * as both ingreso and gasto doesn't collide visually. `share` is computed
 * relative to the biggest bucket of the same kind (not across kinds) — a
 * 5k€ "Aceite" income shouldn't dwarf a 200€ "Fertilizante" expense bar
 * just because the income happens to be larger; users care about the
 * relative weight within the same column (where does my money go vs come
 * from) more than across.
 */
function bucketByCategory(list: Transaccion[]): CategoryBucket[] {
  const map = new Map<string, CategoryBucket>();
  for (const t of list) {
    const key = `${t.kind}:${t.category}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.total += t.amountEur;
    } else {
      map.set(key, {
        key,
        kind: t.kind,
        category: t.category,
        count: 1,
        total: t.amountEur,
        share: 0,
      });
    }
  }
  const buckets = Array.from(map.values());
  let maxIngreso = 0;
  let maxGasto = 0;
  for (const b of buckets) {
    if (b.kind === 'ingreso') maxIngreso = Math.max(maxIngreso, b.total);
    else maxGasto = Math.max(maxGasto, b.total);
  }
  for (const b of buckets) {
    const denom = b.kind === 'ingreso' ? maxIngreso : maxGasto;
    b.share = denom > 0 ? b.total / denom : 0;
  }
  // Gastos first (typically dominant + actionable insight), then ingresos;
  // within each kind sort by amount desc.
  buckets.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'gasto' ? -1 : 1;
    return b.total - a.total;
  });
  return buckets;
}

export function CampanaDetailScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const { campanaId } = route.params;

  const [campana, setCampana] = useState<Campana | null>(null);
  const [tx, setTx] = useState<Transaccion[]>([]);
  const [summary, setSummary] = useState<CampanaSummary | null>(null);
  const [period, setPeriod] = useState<PeriodPreset>('all');
  const [sort, setSort] = useState<SortPreset>('date_desc');
  const [query, setQuery] = useState('');
  const [breakdownExpanded, setBreakdownExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [c, list, sum] = await Promise.all([
        campanasService.getById(campanaId),
        transaccionesService.listByCampana(campanaId),
        transaccionesService.summary(campanaId),
      ]);
      setCampana(c);
      setTx(list);
      setSummary(sum);
      // Keep the navigation header in sync with the (possibly edited) name.
      navigation.setOptions({ title: c.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando campaña');
    }
  }, [campanaId, navigation]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
    // Reload on focus so returning from edit reflects the new name/dates.
    const unsub = navigation.addListener('focus', () => {
      void load();
    });
    return unsub;
  }, [load, navigation]);

  const filteredTx = useMemo(() => {
    const range = resolvePeriod(period);
    if (!range.from && !range.to) return tx;
    return tx.filter((t) => {
      if (range.from && t.occurredAt < range.from) return false;
      if (range.to && t.occurredAt > range.to) return false;
      return true;
    });
  }, [tx, period]);

  // Trim + lowercase once per query change. Empty trimmed query is a
  // no-op signal so the user typing whitespace doesn't filter to zero
  // results unexpectedly.
  const normalisedQuery = useMemo(() => query.trim().toLowerCase(), [query]);

  const searchedTx = useMemo(() => {
    if (normalisedQuery.length === 0) return filteredTx;
    return filteredTx.filter((t) => {
      if (t.category.toLowerCase().includes(normalisedQuery)) return true;
      if (t.description?.toLowerCase().includes(normalisedQuery)) return true;
      return false;
    });
  }, [filteredTx, normalisedQuery]);

  // When neither period nor search narrowing is active we trust the backend
  // summary (it's authoritative). For any active narrowing we recompute
  // locally — backend doesn't know about the user's preset/query, and
  // shipping query params on every keystroke would burn round-trips for
  // what is essentially a `.filter()` on already-loaded data.
  const displaySummary = useMemo(() => {
    const isNarrowed = period !== 'all' || normalisedQuery.length > 0;
    return isNarrowed ? summarizeLocal(campanaId, searchedTx) : summary;
  }, [period, normalisedQuery, summary, searchedTx, campanaId]);

  const buckets = useMemo(() => bucketByCategory(searchedTx), [searchedTx]);

  // Sort is independent from filtering: the bucket breakdown stays grouped
  // by category (its own sort), the summary cares only about totals, only
  // the visible list + the CSV export reflect the user's order preference.
  const sortedTx = useMemo(
    () => [...searchedTx].sort(sortComparator(sort)),
    [searchedTx, sort],
  );

  async function confirmDelete(): Promise<void> {
    if (!campana || deleting) return;
    const hasTx = tx.length > 0;
    const ok = await confirmDestructive({
      title: 'Eliminar campaña',
      message: hasTx
        ? `Esta campaña tiene ${tx.length} movimiento(s). Si hay transacciones confirmadas, el backend impedirá el borrado.`
        : '¿Seguro que quieres eliminar esta campaña? Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
    });
    if (ok) void doDelete();
  }

  async function doDelete(): Promise<void> {
    if (!campana) return;
    setDeleting(true);
    setError(null);
    try {
      await campanasService.remove(campana.id);
      void cancelCampanaNotifications(campana.id);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
      setDeleting(false);
    }
  }

  async function handleExport(): Promise<void> {
    if (!campana || exporting) return;
    setError(null);
    setExporting(true);
    try {
      // Export reflects both filter AND sort — the user's intent when
      // tapping "Exportar" after narrowing to "Mes en curso" sorted by
      // mayor importe is clearly that slice in that order. The summary
      // block uses the filtered totals so the spreadsheet is
      // self-consistent.
      await exportTransaccionesCsv(campana, displaySummary, sortedTx);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar');
    } finally {
      setExporting(false);
    }
  }

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

  const balanceColor =
    (displaySummary?.balance ?? 0) >= 0
      ? theme.colors.primary
      : theme.colors.danger;

  const isFiltered = period !== 'all' || normalisedQuery.length > 0;

  return (
    <Screen>
      {campana ? (
        <View style={styles.headerRow}>
          <Text style={styles.dates}>
            {campana.startDate} → {campana.endDate ?? 'en curso'}
          </Text>
          <View style={styles.headerActions}>
            <Button
              title="Editar"
              variant="ghost"
              onPress={() =>
                navigation.navigate('EditCampana', { campanaId: campana.id })
              }
              disabled={deleting}
            />
            <View style={{ width: theme.spacing.xs }} />
            <Button
              title="Eliminar"
              variant="ghost"
              onPress={confirmDelete}
              loading={deleting}
            />
          </View>
        </View>
      ) : null}

      <Text style={styles.filterLabel}>Periodo</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {PERIOD_PRESETS.map((p) => {
          const selected = period === p;
          return (
            <Text
              key={p}
              onPress={() => setPeriod(p)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              {PERIOD_LABELS[p]}
            </Text>
          );
        })}
      </ScrollView>

      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar por categoría o descripción"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => setQuery('')}
            style={styles.searchClear}
            hitSlop={8}
            accessibilityLabel="Limpiar búsqueda"
          >
            <Text style={styles.searchClearText}>×</Text>
          </Pressable>
        ) : null}
      </View>

      <Card style={styles.summary}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>Ingresos</Text>
            <Text style={styles.summaryValue}>
              {fmtEur(displaySummary?.totalIngresos ?? 0)}
            </Text>
          </View>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>Gastos</Text>
            <Text style={styles.summaryValue}>
              {fmtEur(displaySummary?.totalGastos ?? 0)}
            </Text>
          </View>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>Balance</Text>
            <Text style={[styles.summaryValue, { color: balanceColor }]}>
              {fmtEur(displaySummary?.balance ?? 0)}
            </Text>
          </View>
        </View>
        {isFiltered ? (
          <Text style={styles.summaryNote}>
            Totales del filtro activo · {searchedTx.length} de {tx.length}{' '}
            movimientos
          </Text>
        ) : null}
      </Card>

      {buckets.length > 0 ? (
        <Card style={styles.breakdown}>
          <Text
            onPress={() => setBreakdownExpanded((v) => !v)}
            style={styles.breakdownHeader}
          >
            Por categoría · {buckets.length}{' '}
            {breakdownExpanded ? '▾' : '▸'}
          </Text>
          {breakdownExpanded ? (
            <View style={styles.breakdownList}>
              {buckets.map((b) => {
                const color =
                  b.kind === 'ingreso'
                    ? theme.colors.primary
                    : theme.colors.danger;
                return (
                  <View key={b.key} style={styles.bucketRow}>
                    <View style={styles.bucketHeader}>
                      <Text style={styles.bucketCategory} numberOfLines={1}>
                        {b.category}
                      </Text>
                      <Text style={[styles.bucketAmount, { color }]}>
                        {b.kind === 'ingreso' ? '+' : '−'} {fmtEur(b.total)}
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.max(2, b.share * 100)}%`,
                            backgroundColor: color,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.bucketMeta}>
                      {Math.round(b.share * 100)}% del{' '}
                      {b.kind === 'ingreso' ? 'mayor ingreso' : 'mayor gasto'}{' '}
                      · {b.count} mov.
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </Card>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Movimientos</Text>
        <View style={styles.sectionActions}>
          <Button
            title="Nuevo"
            variant="ghost"
            onPress={() =>
              navigation.navigate('CreateTransaccion', { campanaId })
            }
            disabled={deleting}
          />
          <View style={{ width: theme.spacing.xs }} />
          <Button
            title="Exportar"
            variant="ghost"
            onPress={handleExport}
            loading={exporting}
            disabled={sortedTx.length === 0 || deleting}
          />
        </View>
      </View>
      {sortedTx.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sortRow}
        >
          {SORT_PRESETS.map((s) => {
            const selected = sort === s;
            return (
              <Text
                key={s}
                onPress={() => setSort(s)}
                style={[styles.sortChip, selected && styles.sortChipSelected]}
              >
                {SORT_LABELS[s]}
              </Text>
            );
          })}
        </ScrollView>
      ) : null}
      <FlatList
        data={sortedTx}
        keyExtractor={(t) => t.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {normalisedQuery.length > 0
              ? `Sin coincidencias para "${query.trim()}".`
              : isFiltered
                ? 'Sin movimientos en el periodo seleccionado.'
                : 'Sin movimientos. Confirma tickets de almazara para que aparezcan aquí como gastos.'}
          </Text>
        }
        renderItem={({ item }) => {
          const sign = item.kind === 'ingreso' ? '+' : '−';
          const color =
            item.kind === 'ingreso' ? theme.colors.primary : theme.colors.danger;
          return (
            <Pressable
              onPress={() =>
                navigation.navigate('EditTransaccion', {
                  transaccionId: item.id,
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Editar movimiento ${item.category}`}
            >
              <Card>
                <View style={styles.txRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txCategory}>{item.category}</Text>
                    <Text style={styles.txMeta}>
                      {item.occurredAt}
                      {item.description ? ` · ${item.description}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.txAmount, { color }]}>
                    {sign} {fmtEur(item.amountEur)}
                  </Text>
                </View>
              </Card>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  dates: {
    color: theme.colors.textMuted,
    fontSize: 13,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterLabel: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  filterRow: {
    paddingBottom: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    marginRight: theme.spacing.xs,
    fontSize: 13,
    overflow: 'hidden',
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    color: theme.colors.primaryText,
  },
  searchWrap: {
    position: 'relative',
    marginBottom: theme.spacing.md,
  },
  searchInput: {
    height: 40,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingRight: 36,
    color: theme.colors.text,
    fontSize: 14,
  },
  searchClear: {
    position: 'absolute',
    right: theme.spacing.sm,
    top: 0,
    bottom: 0,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchClearText: {
    color: theme.colors.textMuted,
    fontSize: 22,
    lineHeight: 22,
  },
  summary: { marginBottom: theme.spacing.md },
  summaryRow: { flexDirection: 'row' },
  summaryCol: { flex: 1 },
  summaryLabel: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: 2,
  },
  summaryValue: {
    ...typography.headline,
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  summaryNote: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: theme.spacing.sm,
    fontStyle: 'italic',
  },
  breakdown: {
    marginBottom: theme.spacing.md,
  },
  breakdownHeader: {
    ...typography.headline,
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  breakdownList: {
    marginTop: theme.spacing.sm,
  },
  bucketRow: {
    marginTop: theme.spacing.sm,
  },
  bucketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bucketCategory: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: '500',
    marginRight: theme.spacing.sm,
  },
  bucketAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  barTrack: {
    height: 10,
    backgroundColor: theme.colors.border,
    borderRadius: 5,
    marginTop: theme.spacing.xs,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
    minWidth: 6,
  },
  bucketMeta: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  sortRow: {
    paddingBottom: theme.spacing.sm,
  },
  sortChip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.textMuted,
    marginRight: theme.spacing.xs,
    fontSize: 12,
    overflow: 'hidden',
  },
  sortChipSelected: {
    borderColor: theme.colors.primary,
    color: theme.colors.primary,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  sectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    ...typography.headline,
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  separator: { height: theme.spacing.sm },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  txCategory: {
    ...typography.headline,
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
  },
  txMeta: {
    ...typography.body,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
    fontSize: 12,
  },
  txAmount: {
    ...typography.headline,
    fontWeight: '700',
    fontSize: 16,
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
});
