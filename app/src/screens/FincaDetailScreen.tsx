import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { IconCircle, IconName } from '@/components/IconCircle';
import { ListRow } from '@/components/ListRow';
import { ParcelaMap, ParcelaMapShape } from '@/components/ParcelaMap';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import type { MainStackParamList } from '@/navigation/types';
import { Finca, fincasService } from '@/services/fincas.service';
import {
  FincaFinanceStats,
  fetchFincaFinanceStats,
  filterFinanceStatsYearToDate,
} from '@/services/fincaFinanceStats.service';
import { GeoJsonPolygon, Parcela, parcelasService } from '@/services/parcelas.service';
import { DailyForecast, WeatherForecast, weatherService } from '@/services/weather.service';
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
    icon: IconName;
    title: string;
    subtitle: string;
    onPress: () => void;
  }> = [
    {
      icon: 'map-marker-radius',
      title: 'Parcelas',
      subtitle: 'Recintos SIGPAC asociados a la finca',
      onPress: () => navigation.navigate('ParcelasList', { fincaId }),
    },
    {
      icon: 'calendar-range',
      title: 'Campañas',
      subtitle: 'Periodos de cosecha y rentabilidad',
      onPress: () => navigation.navigate('CampanasList', { fincaId }),
    },
    {
      icon: 'notebook-edit-outline',
      title: 'Cuaderno de campo',
      subtitle: 'Tratamientos, riegos, podas y otras labores',
      onPress: () => navigation.navigate('ActividadesList', { fincaId }),
    },
    {
      icon: 'receipt-text-outline',
      title: 'Tickets de almazara',
      subtitle: 'Escanea y revisa los tickets con OCR',
      onPress: () => navigation.navigate('TicketsList', { fincaId }),
    },
    {
      icon: 'file-document-check-outline',
      title: 'Ficha de inspección',
      subtitle: 'Datos SIGPAC y fitosanitarios listos offline',
      onPress: () =>
        navigation.navigate('FichaInspeccion', {
          fincaId,
          fincaName: finca.name,
        }),
    },
    {
      icon: 'creation',
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
            icon: 'weather-partly-cloudy' as IconName,
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
      icon: 'account-group-outline',
      title: 'Miembros',
      subtitle: 'Invita trabajadores y gestiona permisos',
      onPress: () =>
        navigation.navigate('FincaMembers', { fincaId, fincaName: finca.name }),
    },
  ];

  const previewCampanas = visibleFinance
    ? visibleFinance.campanas.slice(0, CAMPANAS_PREVIEW_LIMIT)
    : [];

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>{finca.name}</Text>
          <View style={styles.roleChip}>
            <Icon
              name={isOwner ? 'account-tie' : 'account-hard-hat'}
              size={14}
              color={theme.colors.primary}
            />
            <Text style={styles.roleText}>{isOwner ? 'Propietario' : 'Trabajador'}</Text>
          </View>
        </View>

        {parcelasConPlazo.length > 0 ? (
          <Pressable
            onPress={() => navigation.navigate('ParcelasList', { fincaId })}
            style={({ pressed }) => [styles.plazoBanner, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${parcelasConPlazo.length} parcelas con plazo de seguridad activo`}
          >
            <IconCircle name="timer-sand" tone="warning" />
            <View style={styles.flex}>
              <Text style={styles.plazoBannerTitle}>
                {parcelasConPlazo.length} parcela
                {parcelasConPlazo.length === 1 ? '' : 's'} con plazo de seguridad activo
              </Text>
              <Text style={styles.plazoBannerBody} numberOfLines={2}>
                {parcelasConPlazo
                  .slice(0, 3)
                  .map((p) => p.name)
                  .join(' · ')}
                {parcelasConPlazo.length > 3 ? ` · +${parcelasConPlazo.length - 3}` : ''}
              </Text>
            </View>
            <Icon name="chevron-right" size={22} color="#5A4200" />
          </Pressable>
        ) : null}

        {mapShapes ? (
          <View style={styles.map}>
            <ParcelaMap shapes={mapShapes} height={200} />
          </View>
        ) : null}

        {forecastLoading ? (
          <View style={styles.forecastLoading}>
            <ActivityIndicator color={theme.colors.primary} size="small" />
          </View>
        ) : forecast && forecast.daily.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle icon="weather-partly-cloudy" title="Previsión 7 días" />
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
                    <Icon
                      name={forecastIcon(day)}
                      size={26}
                      color={day.frostRisk ? FROST_BLUE : theme.colors.primary}
                      style={styles.forecastIcon}
                    />
                    <Text style={styles.forecastTemp}>
                      {Math.round(day.tempMaxC)}° / {Math.round(day.tempMinC)}°
                    </Text>
                    <View style={styles.forecastMetaRow}>
                      <Icon name="water-outline" size={12} color={theme.colors.textMuted} />
                      <Text style={styles.forecastMeta}>
                        {day.precipitationMm.toFixed(1)} mm
                      </Text>
                    </View>
                    <View style={styles.forecastMetaRow}>
                      <Icon name="weather-windy" size={12} color={theme.colors.textMuted} />
                      <Text style={styles.forecastMeta}>
                        {Math.round(day.windSpeedMaxKmh)} km/h
                      </Text>
                    </View>
                    {day.et0Mm !== null ? (
                      <Text style={styles.forecastEt0}>ET₀ {day.et0Mm.toFixed(1)}</Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
            {centroid ? (
              <LinkRow
                label="Ver alertas y previsión completa"
                onPress={() =>
                  navigation.navigate('Weather', {
                    fincaId,
                    fincaName: finca.name,
                    lat: centroid.lat,
                    lon: centroid.lon,
                  })
                }
              />
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionTitle icon="cash-multiple" title="Resumen financiero" />
          <View style={styles.segmented}>
            {FINANCE_PRESETS.map((p) => {
              const selected = financePreset === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => setFinancePreset(p)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.segment, selected && styles.segmentSelected]}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                    {FINANCE_LABELS[p]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {financeLoading ? (
            <View style={styles.panel}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : financeError ? (
            <View style={styles.panel}>
              <Text style={styles.error}>{financeError}</Text>
            </View>
          ) : visibleFinance && visibleFinance.campanas.length === 0 ? (
            <View style={[styles.panel, styles.emptyPanel]}>
              <IconCircle name="calendar-blank-outline" />
              <Text style={[styles.muted, styles.flex]}>
                {financePreset === 'year'
                  ? 'Sin campañas activas en el año en curso. Crea una campaña o cambia a "Todas las campañas".'
                  : 'Sin campañas registradas. Crea la primera para empezar a llevar la contabilidad.'}
              </Text>
            </View>
          ) : visibleFinance ? (
            <>
              {/* DESIGN.md: hero gradient primary → primaryContainer at 135°. */}
              <LinearGradient
                colors={[theme.colors.primary, theme.colors.primaryContainer]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.hero}
              >
                <Text style={styles.heroLabel}>
                  Balance · {financePreset === 'year' ? 'año en curso' : 'histórico total'}
                </Text>
                <Text
                  style={styles.heroValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                >
                  {fmtEur(visibleFinance.balance)}
                </Text>
                <View style={styles.heroSplit}>
                  <HeroFigure
                    icon="trending-up"
                    label="Ingresos"
                    value={fmtEur(visibleFinance.totalIngresos)}
                  />
                  <HeroFigure
                    icon="trending-down"
                    label="Gastos"
                    value={fmtEur(visibleFinance.totalGastos)}
                  />
                </View>
                <Text style={styles.heroHint}>
                  {visibleFinance.campanas.length} campaña
                  {visibleFinance.campanas.length === 1 ? '' : 's'}
                </Text>
              </LinearGradient>

              {previewCampanas.map((cs) => {
                const cBalance = cs.summary.balance;
                return (
                  <ListRow
                    key={cs.campana.id}
                    icon="calendar-range"
                    title={cs.campana.name}
                    meta={`${cs.campana.startDate} → ${cs.campana.endDate ?? 'en curso'} · ${cs.summary.count} mov.`}
                    below={
                      <Text
                        style={[
                          styles.campanaBalance,
                          { color: cBalance >= 0 ? theme.colors.primary : theme.colors.danger },
                        ]}
                      >
                        {fmtEur(cBalance)}
                      </Text>
                    }
                    onPress={() =>
                      navigation.navigate('CampanaDetail', {
                        campanaId: cs.campana.id,
                        campanaName: cs.campana.name,
                      })
                    }
                  />
                );
              })}

              {visibleFinance.campanas.length > CAMPANAS_PREVIEW_LIMIT ? (
                <Text style={styles.moreHint}>
                  Mostrando {CAMPANAS_PREVIEW_LIMIT} de {visibleFinance.campanas.length}{' '}
                  campañas. Abre "Campañas" para ver todas.
                </Text>
              ) : null}

              <LinkRow
                icon="chart-line"
                label="Ver análisis de rentabilidad"
                onPress={() =>
                  navigation.navigate('Rentabilidad', {
                    fincaId,
                    fincaName: finca.name,
                  })
                }
              />
            </>
          ) : null}
        </View>

        <View style={styles.section}>
          <SectionTitle icon="view-grid-outline" title="Secciones" />
          <View style={styles.grid}>
            {sections.map((s) => (
              <Pressable
                key={s.title}
                onPress={s.onPress}
                accessibilityRole="button"
                style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              >
                <IconCircle name={s.icon} />
                <Text style={styles.tileTitle} numberOfLines={2}>
                  {s.title}
                </Text>
                <Text style={styles.tileSubtitle} numberOfLines={3}>
                  {s.subtitle}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isOwner ? (
          <View style={styles.ownerActions}>
            <Pressable
              onPress={() => navigation.navigate('EditFinca', { fincaId: finca.id })}
              disabled={deleting}
              accessibilityRole="button"
              style={({ pressed }) => [styles.ownerButton, styles.editButton, pressed && styles.pressed]}
            >
              <Icon name="pencil-outline" size={18} color={theme.colors.primary} />
              <Text style={[styles.ownerButtonText, { color: theme.colors.primary }]}>
                Editar finca
              </Text>
            </Pressable>
            <Pressable
              onPress={confirmDelete}
              disabled={deleting}
              accessibilityRole="button"
              style={({ pressed }) => [styles.ownerButton, styles.deleteButton, pressed && styles.pressed]}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={theme.colors.danger} />
              ) : (
                <Icon name="trash-can-outline" size={18} color={theme.colors.danger} />
              )}
              <Text style={[styles.ownerButtonText, { color: theme.colors.danger }]}>
                Eliminar finca
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// ---------- Sub-components ----------

const FROST_BLUE = '#4A90D9';

/** Icono del día a partir de los datos reales: helada, lluvia o solo temperatura. */
function forecastIcon(day: DailyForecast): IconName {
  if (day.frostRisk) return 'snowflake';
  if (day.precipitationMm >= 1) return 'weather-rainy';
  return 'thermometer';
}

function HeroFigure({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <View style={styles.heroFigure}>
      <View style={styles.heroFigureLabelRow}>
        <Icon name={icon} size={14} color="rgba(255, 255, 255, 0.8)" />
        <Text style={styles.heroFigureLabel}>{label}</Text>
      </View>
      {/* Sin truncar: una cifra cortada es peor que una que salta de línea. */}
      <Text style={styles.heroFigureValue}>{value}</Text>
    </View>
  );
}

function LinkRow({
  icon,
  label,
  onPress,
}: {
  icon?: IconName;
  label: string;
  onPress: () => void;
}): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
    >
      {icon ? <Icon name={icon} size={18} color={theme.colors.primary} /> : null}
      <Text style={styles.linkText}>{label}</Text>
      <Icon name="chevron-right" size={18} color={theme.colors.primary} />
    </Pressable>
  );
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: theme.spacing.xl },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  section: { marginBottom: theme.spacing.lg },

  header: { marginBottom: theme.spacing.lg },
  title: {
    ...typography.display,
    fontSize: 28,
    color: theme.colors.text,
  },
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: theme.spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(62, 82, 25, 0.10)',
  },
  roleText: {
    ...typography.label,
    fontSize: 12,
    color: theme.colors.primary,
  },

  // Yellow plazo-de-seguridad banner — same palette as the per-parcela
  // banner so both read as one alert system (No-Line: no border).
  plazoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: '#FEF6D8',
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  plazoBannerTitle: {
    ...typography.bodyMedium,
    color: '#5A4200',
    fontSize: 14,
  },
  plazoBannerBody: {
    ...typography.body,
    color: '#7A5C18',
    fontSize: 12,
    marginTop: 2,
  },

  map: {
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    marginBottom: theme.spacing.lg,
  },

  forecastLoading: {
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  forecastRow: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
  },
  forecastCard: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    minWidth: 76,
  },
  forecastDay: {
    ...typography.headline,
    fontSize: 13,
    color: theme.colors.text,
    textTransform: 'uppercase',
  },
  forecastDate: {
    ...typography.body,
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  forecastIcon: { marginVertical: theme.spacing.sm },
  forecastTemp: {
    ...typography.headline,
    fontSize: 14,
    color: theme.colors.text,
    marginBottom: 4,
  },
  forecastMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  forecastMeta: {
    ...typography.body,
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  forecastEt0: {
    ...typography.body,
    fontSize: 10,
    color: theme.colors.textMuted,
    marginTop: 2,
  },

  segmented: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.surfaceLow,
    borderRadius: theme.radius.pill,
    padding: 4,
    marginBottom: theme.spacing.md,
  },
  segment: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  segmentSelected: { backgroundColor: theme.colors.primary },
  segmentText: {
    ...typography.label,
    fontSize: 13,
    color: theme.colors.textMuted,
  },
  segmentTextSelected: { color: theme.colors.primaryText },

  panel: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  emptyPanel: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },

  hero: {
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  heroLabel: {
    ...typography.label,
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 14,
  },
  heroValue: {
    ...typography.display,
    color: theme.colors.primaryText,
    fontSize: 36,
    marginTop: theme.spacing.xs,
  },
  heroSplit: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
  },
  heroFigure: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
  },
  heroFigureLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroFigureLabel: {
    ...typography.label,
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
  },
  heroFigureValue: {
    ...typography.headline,
    color: theme.colors.primaryText,
    fontSize: 15,
    marginTop: 2,
  },
  heroHint: {
    ...typography.body,
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 12,
    marginTop: theme.spacing.sm,
  },

  campanaBalance: {
    ...typography.headline,
    fontSize: 14,
    marginTop: 4,
  },
  moreHint: {
    ...typography.body,
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: theme.spacing.sm,
  },
  linkText: {
    ...typography.bodyMedium,
    color: theme.colors.primary,
    fontSize: 14,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  tileTitle: {
    ...typography.headline,
    fontSize: 15,
    color: theme.colors.text,
    marginTop: theme.spacing.sm,
  },
  tileSubtitle: {
    ...typography.body,
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 2,
  },

  ownerActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  ownerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: theme.radius.pill,
  },
  editButton: { backgroundColor: 'rgba(62, 82, 25, 0.10)' },
  deleteButton: { backgroundColor: 'rgba(178, 59, 59, 0.08)' },
  ownerButtonText: {
    ...typography.headline,
    fontSize: 14,
  },

  muted: {
    ...typography.body,
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  error: {
    color: theme.colors.danger,
    marginTop: theme.spacing.sm,
  },
});
