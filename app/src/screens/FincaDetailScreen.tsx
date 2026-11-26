import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ParcelaMap, ParcelaMapShape } from '@/components/ParcelaMap';
import { Screen } from '@/components/Screen';
import type { MainStackParamList } from '@/navigation/types';
import { Finca, fincasService } from '@/services/fincas.service';
import {
  FincaFinanceStats,
  fetchFincaFinanceStats,
  filterFinanceStatsYearToDate,
} from '@/services/fincaFinanceStats.service';
import { GeoJsonPolygon, Parcela, parcelasService } from '@/services/parcelas.service';
import { WeatherForecast, weatherService } from '@/services/weather.service';
import {
  PlazoStatus,
  loadActivePlazosForFinca,
} from '@/services/plazoSeguridad.service';
import { theme } from '@/theme';
import { typography } from '@/typography';
import { confirmDestructive } from '@/utils/confirm';

type Props = NativeStackScreenProps<MainStackParamList, 'FincaDetail'>;

/** Cap on per-campaign rows shown inline. Past this we show a hint pointing
 * to the full CampanasList screen. Olivar smallholders typically run 1-3
 * active campaigns; this only matters for users with a long historical
 * tail. */
const CAMPANAS_PREVIEW_LIMIT = 4;

type FinancePreset = 'year' | 'all';

const FINANCE_LABELS: Record<FinancePreset, string> = {
  year: 'Año en curso',
  all: 'Todas las campañas',
};

const FINANCE_PRESETS: FinancePreset[] = ['year', 'all'];

function fmtEur(n: number): string {
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function computeCentroid(
  geometry: GeoJsonPolygon,
): { lat: number; lon: number } | null {
  const ring =
    geometry.type === 'Polygon'
      ? (geometry.coordinates as number[][][])[0]
      : (geometry.coordinates as number[][][][])[0]?.[0];
  if (!ring || ring.length === 0) return null;
  let sumLon = 0;
  let sumLat = 0;
  for (const point of ring) {
    sumLon += point[0] ?? 0;
    sumLat += point[1] ?? 0;
  }
  return { lon: sumLon / ring.length, lat: sumLat / ring.length };
}

const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function fmtForecastDay(dateStr: string): { day: string; date: string } {
  const d = new Date(`${dateStr}T12:00:00`);
  return {
    day: DAY_ABBR[d.getDay()] ?? '',
    date: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
  };
}

export function FincaDetailScreen({ route, navigation }: Props): JSX.Element {
  const { fincaId } = route.params;

  const [finca, setFinca] = useState<Finca | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [finance, setFinance] = useState<FincaFinanceStats | null>(null);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [financePreset, setFinancePreset] = useState<FinancePreset>('year');

  // Parcelas are fetched independently of the finca/finance pair so the map
  // can paint as soon as its rows arrive, without blocking on aggregation.
  // We deliberately don't surface a parcelas-error banner — if the list
  // can't load we just skip the map; the user still has full access to the
  // Parcelas section card below.
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [forecast, setForecast] = useState<WeatherForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [centroid, setCentroid] = useState<{ lat: number; lon: number } | null>(null);

  // Map<parcelaId, PlazoStatus> for parcelas with an active plazo de
  // seguridad. Empty map = nothing to surface. We never render an error
  // for this — the chip is a glance helper, the per-parcela detail screen
  // is the authoritative view.
  const [plazos, setPlazos] = useState<Map<string, PlazoStatus>>(new Map());

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const f = await fincasService.getById(fincaId);
      setFinca(f);
      navigation.setOptions({ title: f.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando finca');
    }
  }, [fincaId, navigation]);

  // Finance fetch is independent from finca metadata: races and renders as
  // data arrives. A failure to aggregate finance does NOT block the screen —
  // the navigation hub is still useful even when the totals can't be
  // computed (e.g. transient network blip on one campaign's summary call).
  const loadFinance = useCallback(async (): Promise<void> => {
    setFinanceError(null);
    try {
      const stats = await fetchFincaFinanceStats(fincaId);
      setFinance(stats);
    } catch (err) {
      setFinanceError(
        err instanceof Error ? err.message : 'Error cargando finanzas',
      );
    }
  }, [fincaId]);

  const loadParcelas = useCallback(async (): Promise<void> => {
    try {
      const list = await parcelasService.listByFinca(fincaId);
      setParcelas(list);
      const withGeo = list.find((p) => p.geometry !== null);
      if (withGeo?.geometry) {
        const centroid = computeCentroid(withGeo.geometry);
        if (centroid) {
          setCentroid(centroid);
          setForecastLoading(true);
          weatherService
            .getForecast(centroid.lat, centroid.lon)
            .then((f) => { setForecast(f); })
            .catch(() => { /* silent: forecast is a convenience, not critical */ })
            .finally(() => { setForecastLoading(false); });
        }
      }
    } catch {
      // Silent: the map is a glance helper, not the primary nav. The
      // Parcelas section card below remains the source of truth.
    }
  }, [fincaId]);

  const loadPlazos = useCallback(async (): Promise<void> => {
    try {
      const m = await loadActivePlazosForFinca(fincaId);
      setPlazos(m);
    } catch {
      // Silent — same reasoning as parcelas: the chip is a hint. If it
      // fails the user still has full access to per-parcela detail.
    }
  }, [fincaId]);

  useEffect(() => {
    void Promise.all([
      load().finally(() => setLoading(false)),
      loadFinance().finally(() => setFinanceLoading(false)),
      loadParcelas(),
      loadPlazos(),
    ]);
    // Reload all four on focus so returning from any screen that touched
    // parcelas/transactions/campaigns/actividades reflects in the headline
    // numbers, map and plazo chip without a manual refresh.
    const unsub = navigation.addListener('focus', () => {
      void load();
      void loadFinance();
      void loadParcelas();
      void loadPlazos();
    });
    return unsub;
  }, [load, loadFinance, loadParcelas, loadPlazos, navigation]);

  // Build the map shapes once per parcelas update. We skip parcelas without
  // geometry (created by name only, or with cleared SIGPAC) — they'd just
  // be missing from the map. If nothing has geometry we render nothing at
  // all rather than a "Sin geometría" panel: on the finca hub a permanent
  // empty box would be noise. On per-parcela detail it's useful because
  // that screen is *about* one parcela.
  const mapShapes = useMemo<ParcelaMapShape[] | null>(() => {
    const withGeo = parcelas.filter(
      (p): p is Parcela & { geometry: NonNullable<Parcela['geometry']> } =>
        p.geometry !== null,
    );
    if (withGeo.length === 0) return null;
    return withGeo.map((p) => ({ geometry: p.geometry, label: p.name }));
  }, [parcelas]);

  // Names of parcelas with active plazo de seguridad. We resolve names
  // here (not in the service) so the service stays decoupled from parcela
  // metadata. Sorted by earliest expiry so the chip surfaces the most
  // urgent first.
  const parcelasConPlazo = useMemo<Array<{ id: string; name: string; expiraEl: string }>>(() => {
    if (plazos.size === 0) return [];
    const byId = new Map(parcelas.map((p) => [p.id, p.name] as const));
    const out: Array<{ id: string; name: string; expiraEl: string }> = [];
    for (const [parcelaId, status] of plazos.entries()) {
      out.push({
        id: parcelaId,
        name: byId.get(parcelaId) ?? 'Parcela',
        expiraEl: status.expiraEl,
      });
    }
    return out.sort((a, b) => (a.expiraEl < b.expiraEl ? -1 : 1));
  }, [plazos, parcelas]);

  // Switching presets is a pure client-side narrowing of already-loaded
  // data. No round-trip per toggle.
  const visibleFinance = useMemo(() => {
    if (!finance) return null;
    return financePreset === 'year'
      ? filterFinanceStatsYearToDate(finance)
      : finance;
  }, [finance, financePreset]);

  async function confirmDelete(): Promise<void> {
    if (!finca || deleting) return;
    // Double confirmation — this is the most destructive action in the app
    // and cascades to everything under the finca. The cross-platform
    // confirmDestructive helper works on web AND native; Alert.alert with
    // multiple buttons silently breaks on react-native-web (only renders
    // the first button) so we never trust it for non-info dialogs.
    const ok1 = await confirmDestructive({
      title: 'Eliminar finca',
      message:
        'Se eliminarán TODAS las parcelas, campañas, actividades, tickets y miembros asociados. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
    });
    if (!ok1) return;
    const ok2 = await confirmDestructive({
      title: '¿Confirmar?',
      message: `Vas a borrar "${finca.name}" y todo lo que contiene. Última oportunidad para cancelar.`,
      confirmLabel: 'Eliminar definitivamente',
    });
    if (ok2) void doDelete();
  }

  async function doDelete(): Promise<void> {
    if (!finca) return;
    setDeleting(true);
    setError(null);
    try {
      await fincasService.remove(finca.id);
      // Pop back to the fincas list, which reloads on focus.
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
      setDeleting(false);
    }
  }

  if (loading || !finca) {
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

  const isOwner = finca.role === 'owner';

  const sections: Array<{
    title: string;
    subtitle: string;
    onPress: () => void;
  }> = [
    {
      title: 'Parcelas',
      subtitle: 'Recintos SIGPAC asociados a la finca',
      onPress: () => navigation.navigate('ParcelasList', { fincaId }),
    },
    {
      title: 'Campañas',
      subtitle: 'Periodos de cosecha y rentabilidad',
      onPress: () => navigation.navigate('CampanasList', { fincaId }),
    },
    {
      title: 'Cuaderno de campo',
      subtitle: 'Tratamientos, riegos, podas y otras labores',
      onPress: () => navigation.navigate('ActividadesList', { fincaId }),
    },
    {
      title: 'Tickets de almazara',
      subtitle: 'Escanea y revisa los tickets con OCR',
      onPress: () => navigation.navigate('TicketsList', { fincaId }),
    },
    {
      title: 'Ficha de inspección',
      subtitle: 'Datos SIGPAC y fitosanitarios listos offline',
      onPress: () =>
        navigation.navigate('FichaInspeccion', {
          fincaId,
          fincaName: finca.name,
        }),
    },
    {
      title: 'Asistente IA',
      subtitle: 'Consulta normativa CUE y datos de tu finca',
      onPress: () =>
        navigation.navigate('AiAssistant', {
          fincaId,
          fincaName: finca.name,
        }),
    },
    ...(centroid
      ? [
          {
            title: 'Tiempo y alertas',
            subtitle: 'Previsión 7 días y alertas AEMET',
            onPress: () =>
              navigation.navigate('Weather', {
                fincaId,
                fincaName: finca.name,
                lat: centroid.lat,
                lon: centroid.lon,
              }),
          },
        ]
      : []),
    {
      title: 'Miembros',
      subtitle: 'Invita trabajadores y gestiona permisos',
      onPress: () =>
        navigation.navigate('FincaMembers', { fincaId, fincaName: finca.name }),
    },
  ];

  const balanceColor =
    (visibleFinance?.balance ?? 0) >= 0
      ? theme.colors.primary
      : theme.colors.danger;

  const previewCampanas = visibleFinance
    ? visibleFinance.campanas.slice(0, CAMPANAS_PREVIEW_LIMIT)
    : [];

  return (
    <Screen>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.title}>{finca.name}</Text>
          <Text style={styles.subtitle}>
            Finca · {finca.role === 'owner' ? 'propietario' : 'trabajador'}
          </Text>
        </View>

        {parcelasConPlazo.length > 0 ? (
          <Pressable
            onPress={() =>
              navigation.navigate('ParcelasList', { fincaId })
            }
            style={({ pressed }) => [
              styles.plazoBanner,
              pressed ? styles.plazoBannerPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${parcelasConPlazo.length} parcelas con plazo de seguridad activo`}
          >
            <Text style={styles.plazoBannerTitle}>
              ⚠ {parcelasConPlazo.length} parcela
              {parcelasConPlazo.length === 1 ? '' : 's'} con plazo de seguridad
              activo
            </Text>
            <Text style={styles.plazoBannerBody} numberOfLines={2}>
              {parcelasConPlazo
                .slice(0, 3)
                .map((p) => p.name)
                .join(' · ')}
              {parcelasConPlazo.length > 3
                ? ` · +${parcelasConPlazo.length - 3}`
                : ''}
            </Text>
          </Pressable>
        ) : null}

        {mapShapes ? (
          <ParcelaMap shapes={mapShapes} height={200} />
        ) : null}

        {forecastLoading ? (
          <View style={styles.forecastLoading}>
            <ActivityIndicator color={theme.colors.primary} size="small" />
          </View>
        ) : forecast && forecast.daily.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>Previsión 7 días</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.forecastRow}
            >
              {forecast.daily.map((day) => {
                const { day: dayName, date } = fmtForecastDay(day.date);
                return (
                  <View key={day.date} style={styles.forecastCard}>
                    <Text style={styles.forecastDay}>{dayName}</Text>
                    <Text style={styles.forecastDate}>{date}</Text>
                    {day.frostRisk ? (
                      <Text style={styles.forecastFrost}>❄</Text>
                    ) : null}
                    <Text style={styles.forecastTemp}>
                      {Math.round(day.tempMaxC)}° / {Math.round(day.tempMinC)}°
                    </Text>
                    <Text style={styles.forecastPrecip}>
                      {day.precipitationMm.toFixed(1)} mm
                    </Text>
                    <Text style={styles.forecastWind}>
                      {Math.round(day.windSpeedMaxKmh)} km/h
                    </Text>
                    {day.et0Mm !== null ? (
                      <Text style={styles.forecastEt0}>
                        ET₀ {day.et0Mm.toFixed(1)}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
            {centroid && finca ? (
              <Pressable
                onPress={() =>
                  navigation.navigate('Weather', {
                    fincaId,
                    fincaName: finca.name,
                    lat: centroid.lat,
                    lon: centroid.lon,
                  })
                }
                style={styles.weatherLink}
              >
                <Text style={styles.weatherLinkText}>
                  Ver alertas y previsión completa →
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        <Text style={styles.sectionLabel}>Resumen financiero</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presetRow}
        >
          {FINANCE_PRESETS.map((p) => {
            const selected = financePreset === p;
            return (
              <Text
                key={p}
                onPress={() => setFinancePreset(p)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                {FINANCE_LABELS[p]}
              </Text>
            );
          })}
        </ScrollView>

        {financeLoading ? (
          <Card style={styles.card}>
            <ActivityIndicator color={theme.colors.primary} />
          </Card>
        ) : financeError ? (
          <Card style={styles.card}>
            <Text style={styles.error}>{financeError}</Text>
          </Card>
        ) : visibleFinance && visibleFinance.campanas.length === 0 ? (
          <Card style={styles.card}>
            <Text style={styles.muted}>
              {financePreset === 'year'
                ? 'Sin campañas activas en el año en curso. Crea una campaña o cambia a "Todas las campañas".'
                : 'Sin campañas registradas. Crea la primera para empezar a llevar la contabilidad.'}
            </Text>
          </Card>
        ) : visibleFinance ? (
          <>
            <Card style={styles.card}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryCol}>
                  <Text style={styles.summaryLabel}>Ingresos</Text>
                  <Text style={styles.summaryValue}>
                    {fmtEur(visibleFinance.totalIngresos)}
                  </Text>
                </View>
                <View style={styles.summaryCol}>
                  <Text style={styles.summaryLabel}>Gastos</Text>
                  <Text style={styles.summaryValue}>
                    {fmtEur(visibleFinance.totalGastos)}
                  </Text>
                </View>
                <View style={styles.summaryCol}>
                  <Text style={styles.summaryLabel}>Balance</Text>
                  <Text
                    style={[styles.summaryValue, { color: balanceColor }]}
                  >
                    {fmtEur(visibleFinance.balance)}
                  </Text>
                </View>
              </View>
              <Text style={styles.summaryNote}>
                {visibleFinance.campanas.length}{' '}
                campaña{visibleFinance.campanas.length === 1 ? '' : 's'} ·{' '}
                {financePreset === 'year' ? 'año en curso' : 'histórico total'}
              </Text>
            </Card>

            {previewCampanas.map((cs) => {
              const cBalance = cs.summary.balance;
              const cColor =
                cBalance >= 0 ? theme.colors.primary : theme.colors.danger;
              return (
                <Card
                  key={cs.campana.id}
                  onPress={() =>
                    navigation.navigate('CampanaDetail', {
                      campanaId: cs.campana.id,
                      campanaName: cs.campana.name,
                    })
                  }
                  style={styles.campanaCard}
                >
                  <View style={styles.campanaRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.campanaName}>{cs.campana.name}</Text>
                      <Text style={styles.campanaMeta}>
                        {cs.campana.startDate} →{' '}
                        {cs.campana.endDate ?? 'en curso'} ·{' '}
                        {cs.summary.count} mov.
                      </Text>
                    </View>
                    <Text style={[styles.campanaBalance, { color: cColor }]}>
                      {fmtEur(cBalance)}
                    </Text>
                  </View>
                </Card>
              );
            })}

            {visibleFinance.campanas.length > CAMPANAS_PREVIEW_LIMIT ? (
              <Text style={styles.moreHint}>
                Mostrando {CAMPANAS_PREVIEW_LIMIT} de{' '}
                {visibleFinance.campanas.length} campañas. Abre "Campañas" para
                ver todas.
              </Text>
            ) : null}

            <Pressable
              onPress={() =>
                navigation.navigate('Rentabilidad', {
                  fincaId,
                  fincaName: finca.name,
                })
              }
              style={styles.rentabilidadLink}
            >
              <Text style={styles.rentabilidadLinkText}>
                Ver análisis de rentabilidad →
              </Text>
            </Pressable>
          </>
        ) : null}

        <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>
          Secciones
        </Text>
        {sections.map((s) => (
          <Card key={s.title} onPress={s.onPress} style={styles.card}>
            <Text style={styles.cardTitle}>{s.title}</Text>
            <Text style={styles.cardSubtitle}>{s.subtitle}</Text>
          </Card>
        ))}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isOwner ? (
          <>
            <Button
              title="Editar finca"
              variant="ghost"
              onPress={() =>
                navigation.navigate('EditFinca', { fincaId: finca.id })
              }
              disabled={deleting}
              style={styles.edit}
            />
            <Button
              title="Eliminar finca"
              variant="ghost"
              onPress={confirmDelete}
              loading={deleting}
              style={styles.delete}
            />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { marginBottom: theme.spacing.md },
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
  sectionLabel: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
    marginBottom: theme.spacing.xs,
  },
  sectionLabelSpaced: {
    marginTop: theme.spacing.md,
  },
  presetRow: {
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
  card: {
    marginBottom: theme.spacing.sm,
  },
  cardTitle: {
    ...typography.headline,
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  },
  cardSubtitle: {
    ...typography.body,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  summaryRow: {
    flexDirection: 'row',
  },
  summaryCol: {
    flex: 1,
  },
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
  campanaCard: {
    marginBottom: theme.spacing.xs,
  },
  campanaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  campanaName: {
    ...typography.headline,
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
  },
  campanaMeta: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  campanaBalance: {
    fontSize: 15,
    fontWeight: '700',
    marginLeft: theme.spacing.sm,
  },
  moreHint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  rentabilidadLink: {
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  rentabilidadLinkText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
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
  // Yellow plazo-de-seguridad summary banner — same palette as the
  // per-parcela banner so the two read as one alert system across screens.
  plazoBanner: {
    backgroundColor: '#FEF6D8',
    borderColor: '#E0B84A',
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  plazoBannerPressed: {
    opacity: 0.85,
  },
  plazoBannerTitle: {
    color: '#5A4200',
    fontWeight: '700',
    fontSize: 14,
  },
  plazoBannerBody: {
    color: '#7A5C18',
    fontSize: 12,
    marginTop: 4,
  },
  weatherLink: {
    alignSelf: 'flex-end',
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
    paddingVertical: 4,
  },
  weatherLinkText: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  forecastLoading: {
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  forecastRow: {
    paddingBottom: theme.spacing.sm,
  },
  forecastCard: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    marginRight: theme.spacing.xs,
    minWidth: 72,
  },
  forecastDay: {
    fontWeight: '700',
    fontSize: 12,
    color: theme.colors.text,
    textTransform: 'uppercase',
  },
  forecastDate: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginBottom: 4,
  },
  forecastFrost: {
    fontSize: 14,
    marginBottom: 2,
    color: '#4A90D9',
  },
  forecastTemp: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.text,
  },
  forecastPrecip: {
    fontSize: 11,
    color: theme.colors.primary,
    marginTop: 2,
  },
  forecastWind: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  forecastEt0: {
    fontSize: 10,
    color: theme.colors.textMuted,
    marginTop: 2,
    fontStyle: 'italic',
  },
});
