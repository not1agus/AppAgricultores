import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ParcelaMap } from '@/components/ParcelaMap';
import { PlazoSeguridadBanner } from '@/components/PlazoSeguridadBanner';
import { Screen } from '@/components/Screen';
import type { MainStackParamList } from '@/navigation/types';
import {
  ACTIVIDAD_TYPE_LABELS,
  Actividad,
  ActividadType,
  actividadesService,
} from '@/services/actividades.service';
import {
  GeoJsonPolygon,
  Parcela,
  parcelasService,
} from '@/services/parcelas.service';
import { computeParcelaMetrics } from '@/services/parcelaMetrics.service';
import { strictestActivePlazo } from '@/services/plazoSeguridad.service';
import type { SigpacReference } from '@/services/sigpac.service';
import { theme } from '@/theme';
import { typography } from '@/typography';
import { confirmDestructive } from '@/utils/confirm';

type Props = NativeStackScreenProps<MainStackParamList, 'ParcelaDetail'>;

/** How many recent activities to show inline. Past this we show a counter
 * hint instead of an unbounded list — when a grower opens a parcela the
 * value is "what happened recently here", not "everything ever". For deep
 * historical browsing the cuaderno screen is the right surface. */
const RECENT_LIMIT = 8;

/** Year window for the activity-type breakdown. 12 months covers a full
 * agricultural cycle (poda, abonado, tratamientos primavera/verano, cosecha
 * en otoño/invierno) regardless of when the user opens the screen. */
const TYPE_BREAKDOWN_DAYS = 365;

function formatSigpacRef(ref: SigpacReference | null): string {
  if (!ref) return 'Sin referencia SIGPAC';
  const tail = ref.recinto ? `:${ref.recinto}` : '';
  return `${ref.provincia}:${ref.municipio}:${ref.poligono}:${ref.parcela}${tail}`;
}

function fmtEur(n: number | null): string | null {
  if (n === null) return null;
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function formatRelativeDate(iso: string): string {
  // Manual diff in days against today; avoids dragging in date-fns just to
  // render "hoy / hace N días" for a single label.
  const today = new Date();
  const target = new Date(iso);
  const oneDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(target.getFullYear(), target.getMonth(), target.getDate())) /
      oneDay,
  );
  if (diffDays === 0) return 'hoy';
  if (diffDays === 1) return 'ayer';
  if (diffDays < 0) {
    const days = Math.abs(diffDays);
    return days === 1 ? 'mañana' : `en ${days} días`;
  }
  if (diffDays < 30) return `hace ${diffDays} días`;
  const months = Math.round(diffDays / 30);
  if (months < 12) return `hace ${months} mes${months === 1 ? '' : 'es'}`;
  const years = Math.round(diffDays / 365);
  return `hace ${years} año${years === 1 ? '' : 's'}`;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Cheap centroid: arithmetic mean of every vertex. Not the geometric
 * centroid (Shoelace), but for our convex-ish parcelas it's close enough
 * to drop a "Cómo llegar" pin in the right field. */
function geometryCentroid(g: GeoJsonPolygon): { lat: number; lng: number } | null {
  let sumLng = 0;
  let sumLat = 0;
  let n = 0;
  const visit = (pts: number[][]): void => {
    for (const pt of pts) {
      if (pt.length >= 2) {
        sumLng += pt[0]!;
        sumLat += pt[1]!;
        n++;
      }
    }
  };
  if (g.type === 'Polygon') {
    for (const ring of g.coordinates as number[][][]) visit(ring);
  } else {
    for (const poly of g.coordinates as number[][][][]) {
      for (const ring of poly) visit(ring);
    }
  }
  if (n === 0) return null;
  return { lat: sumLat / n, lng: sumLng / n };
}

/** Open the device's preferred maps app at the given coordinates with a
 * dropped pin. Uses the Google Maps universal URL because it resolves
 * cleanly on both iOS (opens Apple Maps or Google Maps depending on
 * what's installed) and Android (Maps Intent). */
async function openInMaps(lat: number, lng: number, label: string): Promise<void> {
  const q = encodeURIComponent(label);
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${q}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(
      'No se pudo abrir Maps',
      'No hay ninguna aplicación de mapas registrada en este dispositivo.',
    );
  }
}

interface TypeBucket {
  type: ActividadType;
  count: number;
}

function bucketByType(list: Actividad[]): TypeBucket[] {
  const map = new Map<ActividadType, number>();
  for (const a of list) {
    map.set(a.type, (map.get(a.type) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

export function ParcelaDetailScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const { parcelaId, fincaId } = route.params;

  const [parcela, setParcela] = useState<Parcela | null>(null);
  const [actividades, setActividades] = useState<Actividad[]>([]);
  const [loading, setLoading] = useState(true);
  const [actividadesLoading, setActividadesLoading] = useState(true);
  const [actividadesError, setActividadesError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const p = await parcelasService.getById(parcelaId);
      setParcela(p);
      navigation.setOptions({ title: p.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando parcela');
    }
  }, [parcelaId, navigation]);

  // Activities fetch is independent from the parcela metadata fetch — they
  // can race and render as data arrives. A failure to load activities does
  // NOT block showing the parcela info (a grower might still want to edit
  // the parcela even if activity history is temporarily unreachable).
  const loadActividades = useCallback(async (): Promise<void> => {
    setActividadesError(null);
    try {
      const list = await actividadesService.list({ parcelaId });
      // Backend ordering isn't guaranteed; sort by performedAt desc with id
      // as stable tiebreaker so re-renders don't shuffle the list.
      const sorted = [...list].sort((a, b) => {
        if (a.performedAt !== b.performedAt)
          return a.performedAt > b.performedAt ? -1 : 1;
        return a.id < b.id ? 1 : -1;
      });
      setActividades(sorted);
    } catch (err) {
      setActividadesError(
        err instanceof Error ? err.message : 'Error cargando actividades',
      );
    }
  }, [parcelaId]);

  useEffect(() => {
    void Promise.all([
      load().finally(() => setLoading(false)),
      loadActividades().finally(() => setActividadesLoading(false)),
    ]);
    // Reload both on focus so returning from edits / new activity refreshes
    // the screen without a manual pull.
    const unsub = navigation.addListener('focus', () => {
      void load();
      void loadActividades();
    });
    return unsub;
  }, [load, loadActividades, navigation]);

  const recentActividades = useMemo(
    () => actividades.slice(0, RECENT_LIMIT),
    [actividades],
  );

  const lastActividad = actividades[0] ?? null;

  // Plazo de seguridad activo (RD 1311/2012). Computed from the activities
  // we already loaded — no extra round-trip. The "strictest" choice handles
  // the case where two recent tratamientos overlap with different PHIs:
  // the longer expiry wins.
  const activePlazo = useMemo(
    () => strictestActivePlazo(actividades),
    [actividades],
  );

  // Per-type counts over the last year. We compute over the full list and
  // filter by date here rather than refetching with `from=` because we
  // already have everything in memory; one round-trip is cheaper than two.
  const typeBuckets = useMemo(() => {
    const cutoff = isoDaysAgo(TYPE_BREAKDOWN_DAYS);
    return bucketByType(actividades.filter((a) => a.performedAt >= cutoff));
  }, [actividades]);

  // Cost-per-hectare metrics, same 12-month window as the type breakdown
  // above so the two cards line up. Pure derivation — no fetch.
  const metrics12m = useMemo(
    () =>
      computeParcelaMetrics(parcela?.areaHa ?? null, actividades, {
        fromIso: isoDaysAgo(TYPE_BREAKDOWN_DAYS),
      }),
    [parcela?.areaHa, actividades],
  );

  // Centroid is reused twice: once for the map's implicit centring (the
  // map's own fitBounds drives the view) and once for the deep-link to
  // open the device's maps app. Memoised so toggling unrelated state
  // doesn't recompute on every render. MUST live above the early-return
  // below so the hook order stays stable across renders (Rules of Hooks).
  const centroid = useMemo(
    () => (parcela?.geometry ? geometryCentroid(parcela.geometry) : null),
    [parcela?.geometry],
  );

  async function confirmDelete(): Promise<void> {
    if (!parcela || deleting) return;
    const ok = await confirmDestructive({
      title: 'Eliminar parcela',
      message:
        'Si hay actividades asociadas, el backend impedirá el borrado. ¿Continuar?',
      confirmLabel: 'Eliminar',
    });
    if (ok) void doDelete();
  }

  async function doDelete(): Promise<void> {
    if (!parcela) return;
    setDeleting(true);
    setError(null);
    try {
      await parcelasService.remove(parcela.id);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
      setDeleting(false);
    }
  }

  if (loading || !parcela) {
    return (
      <Screen>
        <View style={styles.center}>
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ActivityIndicator color={theme.colors.primary} />
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView>
        <Text style={styles.title}>{parcela.name}</Text>

        {/* Map sits at the top — for a grower the visual answer to "which
            plot is this?" beats every label below. ParcelaMap renders its
            own empty state when geometry is null, so we don't need a
            conditional wrapper here. */}
        <ParcelaMap
          shapes={
            parcela.geometry
              ? [{ geometry: parcela.geometry, label: parcela.name }]
              : null
          }
        />

        {centroid ? (
          <Pressable
            onPress={() => void openInMaps(centroid.lat, centroid.lng, parcela.name)}
            style={({ pressed }) => [
              styles.mapsLink,
              pressed ? styles.mapsLinkPressed : null,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.mapsLinkText}>
              Abrir en Maps · cómo llegar
            </Text>
          </Pressable>
        ) : null}

        {/* Plazo de seguridad — sits above the metadata card so a grower
            opening the parcela mid-PHI sees the warning before any other
            info. Tap drops them into the offending tratamiento detail to
            verify the plazo and product. */}
        <PlazoSeguridadBanner
          status={activePlazo}
          onPress={(s) =>
            navigation.navigate('ActividadDetail', {
              actividadId: s.actividadId,
              fincaId,
            })
          }
        />

        <Card style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Referencia SIGPAC</Text>
            <Text style={styles.value}>{formatSigpacRef(parcela.sigpacRef)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Superficie</Text>
            <Text style={styles.value}>
              {parcela.areaHa !== null
                ? `${parcela.areaHa.toFixed(2)} ha`
                : '—'}
            </Text>
          </View>
          {centroid ? (
            <View style={styles.row}>
              <Text style={styles.label}>Centroide</Text>
              <Text style={styles.value}>
                {centroid.lat.toFixed(5)}, {centroid.lng.toFixed(5)}
              </Text>
            </View>
          ) : null}
        </Card>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Actividades</Text>
          <Button
            title="Nueva"
            variant="ghost"
            onPress={() =>
              navigation.navigate('CreateActividad', {
                fincaId,
                parcelaId: parcela.id,
              })
            }
            disabled={deleting}
          />
        </View>

        {actividadesLoading ? (
          <Card style={styles.card}>
            <ActivityIndicator color={theme.colors.primary} />
          </Card>
        ) : actividadesError ? (
          <Card style={styles.card}>
            <Text style={styles.error}>{actividadesError}</Text>
          </Card>
        ) : actividades.length === 0 ? (
          <Card style={styles.card}>
            <Text style={styles.muted}>
              Sin actividades registradas en esta parcela. Pulsa "Nueva" para
              registrar la primera (poda, tratamiento, abonado…).
            </Text>
          </Card>
        ) : (
          <>
            <Card style={styles.card}>
              <View style={styles.statsRow}>
                <View style={styles.statCol}>
                  <Text style={styles.label}>Total</Text>
                  <Text style={styles.value}>{actividades.length}</Text>
                </View>
                <View style={styles.statCol}>
                  <Text style={styles.label}>Última</Text>
                  <Text style={styles.value}>
                    {lastActividad
                      ? formatRelativeDate(lastActividad.performedAt)
                      : '—'}
                  </Text>
                </View>
              </View>
              {lastActividad ? (
                <Text style={styles.lastTypeNote}>
                  {ACTIVIDAD_TYPE_LABELS[lastActividad.type]} ·{' '}
                  {lastActividad.performedAt}
                </Text>
              ) : null}
            </Card>

            {/* Costes por hectárea — only shown when at least one row in
                the 12m window has a cost. Without that, the card would
                say "0 €/ha" which reads as a misleading insight rather
                than a missing-data state. */}
            {metrics12m.activityCountWithCost > 0 ? (
              <Card style={styles.card}>
                <Text style={styles.label}>Costes · últimos 12 meses</Text>
                <View style={styles.metricsHeadlineRow}>
                  <Text style={styles.metricsHeadline}>
                    {metrics12m.costEurPerHa !== null
                      ? `${metrics12m.costEurPerHa.toLocaleString('es-ES', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })} €/ha`
                      : `${metrics12m.totalCostEur.toLocaleString('es-ES', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })} €`}
                  </Text>
                  <Text style={styles.metricsHeadlineSub}>
                    {metrics12m.costEurPerHa !== null
                      ? `${metrics12m.totalCostEur.toLocaleString('es-ES', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })} € totales`
                      : 'Sin superficie definida'}
                  </Text>
                </View>
                <Text style={styles.metricsNote}>
                  {metrics12m.activityCountWithCost} de{' '}
                  {metrics12m.activityCount} actividades con coste registrado
                  {metrics12m.fitosanitarioCostEur > 0
                    ? ` · tratamientos: ${metrics12m.fitosanitarioCostEur.toLocaleString(
                        'es-ES',
                        { minimumFractionDigits: 0, maximumFractionDigits: 0 },
                      )} €`
                    : ''}
                </Text>

                {/* Top-3 desglose by type — keeps the card glanceable.
                    Each row shows total €, share %, and €/ha when area
                    is known. */}
                {metrics12m.byType.slice(0, 3).map((b) => {
                  const eurPerHaByType =
                    parcela.areaHa && parcela.areaHa > 0
                      ? b.totalCostEur / parcela.areaHa
                      : null;
                  return (
                    <View key={b.type} style={styles.metricsRow}>
                      <Text style={styles.metricsRowLabel} numberOfLines={1}>
                        {b.label}
                      </Text>
                      <Text style={styles.metricsRowValue}>
                        {b.totalCostEur.toLocaleString('es-ES', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}{' '}
                        € · {Math.round(b.share * 100)}%
                        {eurPerHaByType !== null
                          ? ` · ${eurPerHaByType.toLocaleString('es-ES', {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            })} €/ha`
                          : ''}
                      </Text>
                    </View>
                  );
                })}

                {parcela.areaHa === null ? (
                  <Text style={styles.metricsHint}>
                    Define la superficie de la parcela para ver el coste por
                    hectárea.
                  </Text>
                ) : null}
              </Card>
            ) : null}

            {typeBuckets.length > 0 ? (
              <Card style={styles.card}>
                <Text style={styles.label}>Últimos 12 meses · por tipo</Text>
                <View style={styles.typeChipsRow}>
                  {typeBuckets.map((b) => (
                    <Text key={b.type} style={styles.typeChip}>
                      {ACTIVIDAD_TYPE_LABELS[b.type]} · {b.count}
                    </Text>
                  ))}
                </View>
              </Card>
            ) : null}

            {recentActividades.map((a, idx) => {
              const cost = fmtEur(a.costEur);
              return (
                <Pressable
                  key={a.id}
                  onPress={() =>
                    navigation.navigate('ActividadDetail', {
                      actividadId: a.id,
                      fincaId,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Ver actividad ${ACTIVIDAD_TYPE_LABELS[a.type]} del ${a.performedAt}`}
                  style={idx > 0 ? styles.actCardSpacer : undefined}
                >
                  <Card>
                    <View style={styles.actRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.actType}>
                          {ACTIVIDAD_TYPE_LABELS[a.type]}
                        </Text>
                        <Text style={styles.actMeta}>
                          {a.performedAt} · {formatRelativeDate(a.performedAt)}
                          {a.photos.length > 0
                            ? ` · ${a.photos.length} foto${a.photos.length === 1 ? '' : 's'}`
                            : ''}
                        </Text>
                        {a.description ? (
                          <Text style={styles.actDesc} numberOfLines={2}>
                            {a.description}
                          </Text>
                        ) : null}
                      </View>
                      {cost ? (
                        <Text style={styles.actCost}>{cost}</Text>
                      ) : null}
                    </View>
                  </Card>
                </Pressable>
              );
            })}

            {actividades.length > RECENT_LIMIT ? (
              <Text style={styles.moreHint}>
                Mostrando las {RECENT_LIMIT} más recientes de{' '}
                {actividades.length}. Abre el cuaderno de campo para ver el
                histórico completo.
              </Text>
            ) : null}
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title="Editar parcela"
          variant="ghost"
          onPress={() =>
            navigation.navigate('EditParcela', { parcelaId: parcela.id })
          }
          disabled={deleting}
          style={styles.edit}
        />
        <Button
          title="Eliminar parcela"
          variant="ghost"
          onPress={confirmDelete}
          loading={deleting}
          style={styles.delete}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: {
    ...typography.display,
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  card: { marginBottom: theme.spacing.md },
  mapsLink: {
    alignSelf: 'flex-start',
    marginTop: -theme.spacing.xs,
    marginBottom: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
  },
  mapsLinkPressed: {
    opacity: 0.7,
  },
  mapsLinkText: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  label: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  value: {
    ...typography.bodyMedium,
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: theme.spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  sectionTitle: {
    ...typography.headline,
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  },
  statsRow: {
    flexDirection: 'row',
  },
  statCol: {
    flex: 1,
  },
  lastTypeNote: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: theme.spacing.sm,
  },
  typeChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: theme.spacing.sm,
  },
  metricsHeadlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: theme.spacing.xs,
  },
  metricsHeadline: {
    ...typography.display,
    fontSize: 22,
    fontWeight: '700',
    color: theme.colors.text,
  },
  metricsHeadlineSub: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginLeft: theme.spacing.sm,
    flexShrink: 1,
  },
  metricsNote: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: theme.spacing.xs,
    fontStyle: 'italic',
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  metricsRowLabel: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    marginRight: theme.spacing.sm,
  },
  metricsRowValue: {
    color: theme.colors.text,
    fontSize: 13,
    flexShrink: 0,
  },
  metricsHint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: theme.spacing.sm,
    fontStyle: 'italic',
  },
  typeChip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    marginRight: theme.spacing.xs,
    marginTop: theme.spacing.xs,
    fontSize: 12,
    overflow: 'hidden',
  },
  actCardSpacer: {
    marginTop: theme.spacing.xs,
  },
  actRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actType: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
  },
  actMeta: {
    color: theme.colors.textMuted,
    marginTop: 2,
    fontSize: 12,
  },
  actDesc: {
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
    fontSize: 13,
  },
  actCost: {
    fontWeight: '700',
    fontSize: 14,
    color: theme.colors.text,
    marginLeft: theme.spacing.sm,
  },
  moreHint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  muted: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  edit: {
    marginTop: theme.spacing.lg,
  },
  delete: {
    marginTop: theme.spacing.sm,
    borderColor: theme.colors.danger,
  },
  error: {
    color: theme.colors.danger,
    marginTop: theme.spacing.sm,
  },
});
