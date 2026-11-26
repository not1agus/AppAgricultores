import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { OfflineBadge } from '@/components/OfflineBadge';
import { Screen } from '@/components/Screen';
import type { MainStackParamList } from '@/navigation/types';
import {
  ACTIVIDAD_TYPE_LABELS,
  ACTIVIDAD_TYPES,
  Actividad,
  ActividadType,
  actividadesService,
} from '@/services/actividades.service';
import { NetworkError } from '@/services/api';
import { exportCdeFitosanitariosCsv } from '@/services/cdeExport.service';
import { exportActividadesCsv } from '@/services/cuadernoExport.service';
import { exportCuadernoPdf } from '@/services/cuadernoExportPdf';
import { fincasService } from '@/services/fincas.service';
import { formatCacheAge } from '@/services/offlineCache.service';
import { Parcela, parcelasService } from '@/services/parcelas.service';
import { theme } from '@/theme';
import { typography } from '@/typography';
import { fmtDate } from '@/utils/date';

type Props = NativeStackScreenProps<MainStackParamList, 'ActividadesList'>;

function fmtEur(n: number | null): string | null {
  if (n === null) return null;
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function fmtEurAbs(n: number): string {
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

interface TypeBucket {
  type: ActividadType;
  count: number;
  /** Sum of `costEur` treating null as 0 — see comment in `bucketByType`. */
  totalCost: number;
  /** Number of activities in this bucket that had a recorded cost. */
  costedCount: number;
  /** 0..1, share of `totalCost` over the largest bucket. */
  share: number;
}

/**
 * Group activities by type for the cuaderno breakdown. `costEur` is nullable
 * (some activities — observations, scouting — legitimately have no cost),
 * so we track `costedCount` separately. Buckets where every activity has a
 * null cost still appear with totalCost=0 and a zero-width bar, so the user
 * sees "I did 5 observations" alongside the costed work.
 *
 * Sort by totalCost desc with count as tiebreaker — actionable insight is
 * "where did the money go", and within free activities "what did I do most".
 */
function bucketByType(list: Actividad[]): TypeBucket[] {
  const map = new Map<ActividadType, TypeBucket>();
  for (const a of list) {
    let b = map.get(a.type);
    if (!b) {
      b = {
        type: a.type,
        count: 0,
        totalCost: 0,
        costedCount: 0,
        share: 0,
      };
      map.set(a.type, b);
    }
    b.count += 1;
    if (a.costEur !== null) {
      b.totalCost += a.costEur;
      b.costedCount += 1;
    }
  }
  const buckets = Array.from(map.values());
  let max = 0;
  for (const b of buckets) max = Math.max(max, b.totalCost);
  for (const b of buckets) {
    b.share = max > 0 ? b.totalCost / max : 0;
  }
  buckets.sort((a, b) => {
    if (b.totalCost !== a.totalCost) return b.totalCost - a.totalCost;
    return b.count - a.count;
  });
  return buckets;
}

type PeriodPreset = 'all' | 'year' | 'last12' | 'month';

const PERIOD_LABELS: Record<PeriodPreset, string> = {
  all: 'Todo',
  year: 'Año en curso',
  last12: 'Últimos 12 meses',
  month: 'Mes en curso',
};

const PERIOD_PRESETS: PeriodPreset[] = ['all', 'year', 'last12', 'month'];

function toIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Resolve a preset to inclusive ISO `from`/`to` bounds. Computed against the
 * current local date — re-evaluated on every reload (cheap), so a session left
 * open across midnight transparently advances the window.
 */
function resolvePeriod(preset: PeriodPreset): {
  from?: string;
  to?: string;
} {
  if (preset === 'all') return {};
  const now = new Date();
  if (preset === 'year') {
    return {
      from: toIso(new Date(now.getFullYear(), 0, 1)),
      to: toIso(new Date(now.getFullYear(), 11, 31)),
    };
  }
  if (preset === 'last12') {
    const from = new Date(now);
    from.setMonth(from.getMonth() - 12);
    return { from: toIso(from), to: toIso(now) };
  }
  // month
  return {
    from: toIso(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

export function ActividadesListScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const { fincaId } = route.params;
  const [actividades, setActividades] = useState<Actividad[]>([]);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [typeFilter, setTypeFilter] = useState<ActividadType | null>(null);
  const [period, setPeriod] = useState<PeriodPreset>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingCde, setExportingCde] = useState(false);
  const [breakdownExpanded, setBreakdownExpanded] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const parcelasById = useMemo(() => {
    const map = new Map<string, Parcela>();
    for (const p of parcelas) map.set(p.id, p);
    return map;
  }, [parcelas]);

  const normalisedQuery = useMemo(() => query.trim().toLowerCase(), [query]);

  // Client-side text filter over the period+type-narrowed set the API
  // already returned. Match against description, the translated type label
  // (so "poda" finds prunings even if the user hasn't tapped the chip), and
  // the parcela name (frequent recall pattern: "what did I do in la huerta
  // de arriba?"). Activities whose parcela isn't loaded yet still match on
  // their other fields — never block on a missing lookup.
  const searchedActividades = useMemo(() => {
    if (normalisedQuery.length === 0) return actividades;
    return actividades.filter((a) => {
      if (a.description?.toLowerCase().includes(normalisedQuery)) return true;
      if (
        ACTIVIDAD_TYPE_LABELS[a.type]
          .toLowerCase()
          .includes(normalisedQuery)
      ) {
        return true;
      }
      const parcela = parcelasById.get(a.parcelaId);
      if (parcela?.name.toLowerCase().includes(normalisedQuery)) return true;
      return false;
    });
  }, [actividades, normalisedQuery, parcelasById]);

  const buckets = useMemo(
    () => bucketByType(searchedActividades),
    [searchedActividades],
  );

  // Surfaced even when zero so the user sees that the filtered slice has
  // no costed activities (vs simply hiding it would suggest the breakdown
  // wasn't computed).
  const totalCost = useMemo(
    () => buckets.reduce((sum, b) => sum + b.totalCost, 0),
    [buckets],
  );

  const CACHE_KEY = `cache_v1_actividades_${fincaId}`;
  const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const range = resolvePeriod(period);
      const [acts, parcs] = await Promise.all([
        actividadesService.list({
          fincaId,
          ...(typeFilter ? { type: typeFilter } : {}),
          ...range,
        }),
        parcelasService.listByFinca(fincaId),
      ]);
      setActividades(acts);
      setParcelas(parcs);
      setFromCache(false);
      setCachedAt(null);
      try {
        await AsyncStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ actividades: acts, parcelas: parcs, savedAt: new Date().toISOString() }),
        );
      } catch { /* best-effort */ }
    } catch (err) {
      if (err instanceof NetworkError) {
        try {
          const raw = await AsyncStorage.getItem(CACHE_KEY);
          if (raw) {
            const cached = JSON.parse(raw) as {
              actividades: Actividad[];
              parcelas: Parcela[];
              savedAt: string;
            };
            const age = Date.now() - new Date(cached.savedAt).getTime();
            if (age <= CACHE_MAX_AGE_MS) {
              setActividades(cached.actividades);
              setParcelas(cached.parcelas);
              setFromCache(true);
              setCachedAt(cached.savedAt);
              return;
            }
          }
        } catch { /* corrupted cache */ }
      }
      setError(err instanceof Error ? err.message : 'Error cargando actividades');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fincaId, typeFilter, period]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      void load();
    });
    void load().finally(() => setLoading(false));
    return unsub;
  }, [load, navigation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function handleExportPdf(): Promise<void> {
    if (exportingPdf) return;
    setError(null);
    setExportingPdf(true);
    try {
      const finca = await fincasService.getById(fincaId);
      await exportCuadernoPdf(finca, parcelas, null, searchedActividades);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar el PDF');
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleExport(): Promise<void> {
    if (exporting) return;
    setError(null);
    setExporting(true);
    try {
      // Resolve the finca name only at export time — purely cosmetic for the
      // generated filename, no need to block the initial render on it.
      const finca = await fincasService.getById(fincaId);
      // Export reflects the active text search too — if the user filtered
      // to "poda" they want a CSV of prunings, not the whole period.
      await exportActividadesCsv(finca.name, searchedActividades, parcelas);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar');
    } finally {
      setExporting(false);
    }
  }

  async function handleExportCde(): Promise<void> {
    if (exportingCde) return;
    setError(null);
    setExportingCde(true);
    try {
      const finca = await fincasService.getById(fincaId);
      await exportCdeFitosanitariosCsv(finca.name, searchedActividades, parcelas);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar para CDE');
    } finally {
      setExportingCde(false);
    }
  }

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
      {fromCache && cachedAt ? (
        <View style={styles.cacheBanner}>
          <Text style={styles.cacheBannerText}>
            Sin conexión · Datos guardados {formatCacheAge(cachedAt)}
          </Text>
        </View>
      ) : null}
      <OfflineBadge compact />
      <View style={styles.header}>
        <Text style={styles.title}>Cuaderno</Text>
        <View style={styles.headerActions}>
          <Button
            title="PDF"
            variant="ghost"
            onPress={handleExportPdf}
            loading={exportingPdf}
            disabled={searchedActividades.length === 0}
          />
          <View style={{ width: theme.spacing.xs }} />
          <Button
            title="CSV"
            variant="ghost"
            onPress={handleExport}
            loading={exporting}
            disabled={searchedActividades.length === 0}
          />
          <View style={{ width: theme.spacing.xs }} />
          <Button
            title="CDE"
            variant="ghost"
            onPress={handleExportCde}
            loading={exportingCde}
            disabled={
              searchedActividades.filter(
                (a) => a.type === 'tratamiento_fitosanitario',
              ).length === 0
            }
          />
          <View style={{ width: theme.spacing.xs }} />
          <Button
            title="Nueva"
            onPress={() => navigation.navigate('CreateActividad', { fincaId })}
          />
        </View>
      </View>

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

      <Text style={styles.filterLabel}>Tipo</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        <Text
          onPress={() => setTypeFilter(null)}
          style={[styles.chip, typeFilter === null && styles.chipSelected]}
        >
          Todos
        </Text>
        {ACTIVIDAD_TYPES.map((t) => {
          const selected = typeFilter === t;
          return (
            <Text
              key={t}
              onPress={() => setTypeFilter(t)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              {ACTIVIDAD_TYPE_LABELS[t]}
            </Text>
          );
        })}
      </ScrollView>

      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar por descripción, tipo o parcela"
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

      {buckets.length > 0 ? (
        <Card style={styles.breakdown}>
          <Text
            onPress={() => setBreakdownExpanded((v) => !v)}
            style={styles.breakdownHeader}
          >
            Por tipo · {searchedActividades.length} act. ·{' '}
            {fmtEurAbs(totalCost)}{' '}
            {breakdownExpanded ? '▾' : '▸'}
          </Text>
          {breakdownExpanded ? (
            <View style={styles.breakdownList}>
              {buckets.map((b) => {
                const cost = fmtEurAbs(b.totalCost);
                // "0 €" is meaningless when the whole bucket has no
                // recorded cost — swap to "sin coste" for clarity.
                const costLabel =
                  b.costedCount === 0 ? 'sin coste' : cost;
                return (
                  <View key={b.type} style={styles.bucketRow}>
                    <View style={styles.bucketHeader}>
                      <Text style={styles.bucketCategory} numberOfLines={1}>
                        {ACTIVIDAD_TYPE_LABELS[b.type]}
                      </Text>
                      <Text style={styles.bucketAmount}>{costLabel}</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.max(2, b.share * 100)}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.bucketMeta}>
                      {b.count} act.
                      {b.costedCount > 0 && b.costedCount < b.count
                        ? ` · ${b.costedCount} con coste`
                        : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </Card>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={searchedActividades}
        keyExtractor={(a) => a.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {parcelas.length === 0
              ? 'Esta finca aún no tiene parcelas. Añade parcelas para registrar actividades.'
              : normalisedQuery.length > 0
                ? `Sin coincidencias para "${query.trim()}".`
                : period !== 'all' || typeFilter !== null
                  ? 'Sin actividades para los filtros seleccionados.'
                  : 'Sin actividades registradas. Toca «Nueva» para añadir una.'}
          </Text>
        }
        renderItem={({ item }) => {
          const parcela = parcelasById.get(item.parcelaId);
          const cost = fmtEur(item.costEur);
          return (
            <Card
              onPress={() =>
                navigation.navigate('ActividadDetail', {
                  actividadId: item.id,
                  fincaId,
                })
              }
            >
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>
                  {ACTIVIDAD_TYPE_LABELS[item.type]}
                </Text>
                <Text style={styles.itemDate}>{fmtDate(item.performedAt)}</Text>
              </View>
              <Text style={styles.itemMeta}>
                {parcela?.name ?? 'Parcela desconocida'}
                {cost ? ` · ${cost}` : ''}
              </Text>
              {item.description ? (
                <Text style={styles.itemDesc} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cacheBanner: {
    backgroundColor: '#FFF3CD',
    borderColor: '#D08A2A',
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    marginBottom: theme.spacing.sm,
  },
  cacheBannerText: {
    color: '#7A5000',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    ...typography.display,
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
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
    ...typography.bodyMedium,
    flex: 1,
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: '500',
    marginRight: theme.spacing.sm,
  },
  bucketAmount: {
    ...typography.headline,
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.text,
  },
  barTrack: {
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    marginTop: theme.spacing.xs,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: theme.colors.primary,
  },
  bucketMeta: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  separator: { height: theme.spacing.sm },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTitle: {
    ...typography.headline,
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    flex: 1,
  },
  itemDate: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginLeft: theme.spacing.sm,
  },
  itemMeta: {
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
    fontSize: 13,
  },
  itemDesc: {
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
    fontSize: 13,
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
