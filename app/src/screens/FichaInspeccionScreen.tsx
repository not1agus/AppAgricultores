import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import type { MainStackParamList } from '@/navigation/types';
import {
  Actividad,
  actividadesService,
} from '@/services/actividades.service';
import { Campana, campanasService } from '@/services/campanas.service';
import { exportCuadernoPdf } from '@/services/cuadernoExportPdf';
import { Finca, fincasService } from '@/services/fincas.service';
import { Parcela, parcelasService } from '@/services/parcelas.service';
import { theme } from '@/theme';
import { typography } from '@/typography';
import { fmtDate } from '@/utils/date';

type Props = NativeStackScreenProps<MainStackParamList, 'FichaInspeccion'>;

// ─── Types ───────────────────────────────────────────────────────────────────

interface FichaData {
  finca: Finca;
  parcelas: Parcela[];
  campanas: Campana[];
  actividades: Actividad[];
  cachedAt: string;
}

const CACHE_PREFIX = 'fichaInspeccion_v1_';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cacheKey(fincaId: string): string {
  return `${CACHE_PREFIX}${fincaId}`;
}

async function loadFromCache(fincaId: string): Promise<FichaData | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(fincaId));
    if (!raw) return null;
    const data = JSON.parse(raw) as FichaData;
    const age = Date.now() - new Date(data.cachedAt).getTime();
    if (age > CACHE_MAX_AGE_MS) return null;
    return data;
  } catch {
    return null;
  }
}

async function saveToCache(fincaId: string, data: Omit<FichaData, 'cachedAt'>): Promise<void> {
  try {
    const payload: FichaData = { ...data, cachedAt: new Date().toISOString() };
    await AsyncStorage.setItem(cacheKey(fincaId), JSON.stringify(payload));
  } catch {
    // best-effort cache write
  }
}

function fmtCacheAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} día${days !== 1 ? 's' : ''}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ title }: { title: string }): JSX.Element {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function FichaInspeccionScreen({ route }: Props): JSX.Element {
  const { fincaId, fincaName } = route.params;

  const [data, setData] = useState<FichaData | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setError(null);
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const fromDate = cutoff.toISOString().slice(0, 10);

      const [finca, parcelas, campanas, actividades] = await Promise.all([
        fincasService.getById(fincaId),
        parcelasService.listByFinca(fincaId),
        campanasService.listByFinca(fincaId),
        actividadesService.list({
          fincaId,
          type: 'tratamiento_fitosanitario',
          from: fromDate,
        }),
      ]);
      const fetched = { finca, parcelas, campanas, actividades };
      await saveToCache(fincaId, fetched);
      setData({ ...fetched, cachedAt: new Date().toISOString() });
      setFromCache(false);
    } catch {
      // Network unavailable — try cache
      const cached = await loadFromCache(fincaId);
      if (cached) {
        setData(cached);
        setFromCache(true);
      } else {
        setError('Sin conexión y sin datos guardados. Abre la ficha una vez con wifi.');
      }
    }
  }, [fincaId]);

  useEffect(() => {
    // On first load: show cached data immediately while fetching fresh
    loadFromCache(fincaId).then((cached) => {
      if (cached) {
        setData(cached);
        setFromCache(true);
        setLoading(false);
      }
      void load(true).finally(() => setLoading(false));
    });
  }, [fincaId, load]);

  async function onRefresh(): Promise<void> {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  }

  async function onExportPdf(): Promise<void> {
    if (!data) return;
    setExporting(true);
    try {
      const activaCampana = data.campanas.find((c) => c.endDate === null) ?? null;
      await exportCuadernoPdf(
        data.finca,
        data.parcelas,
        activaCampana,
        data.actividades,
      );
    } catch (err) {
      Alert.alert(
        'Error al exportar',
        err instanceof Error ? err.message : 'No se pudo generar el PDF.',
      );
    } finally {
      setExporting(false);
    }
  }

  if (loading && !data) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  if (error && !data) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.errorIcon}>📵</Text>
          <Text style={styles.errorTitle}>Sin datos guardados</Text>
          <Text style={styles.errorBody}>{error}</Text>
        </View>
      </Screen>
    );
  }

  if (!data) return <Screen />;

  const { finca, parcelas, campanas, actividades } = data;
  const activaCampana = campanas.find((c) => c.endDate === null);
  const recentCampanas = campanas
    .filter((c) => c.endDate !== null)
    .sort((a, b) => (b.startDate > a.startDate ? 1 : -1))
    .slice(0, 3);

  // Unique operators across all recorded phytosanitary activities
  const operators = new Map<string, string | null>();
  for (const a of actividades) {
    if (a.fitosanitario?.operadorNombre) {
      operators.set(a.fitosanitario.operadorNombre, a.fitosanitario.operadorCarnet ?? null);
    }
  }

  return (
    <Screen>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* ── Status badge + export button ── */}
        <View style={styles.topRow}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, fromCache ? styles.dotOffline : styles.dotOnline]} />
            <Text style={styles.statusText}>
              {fromCache
                ? `Guardado · ${fmtCacheAge(data.cachedAt)}`
                : `Actualizado ahora`}
            </Text>
          </View>
          <Pressable
            onPress={onExportPdf}
            disabled={exporting}
            style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
          >
            {exporting ? (
              <ActivityIndicator size="small" color={theme.colors.primaryText} />
            ) : (
              <Text style={styles.exportBtnText}>Exportar PDF CUE</Text>
            )}
          </Pressable>
        </View>

        {/* ── Finca ── */}
        <SectionTitle title="Explotación" />
        <Card style={styles.card}>
          <InfoRow label="Nombre" value={finca.name} />
          <InfoRow label="Parcelas registradas" value={String(parcelas.length)} />
        </Card>

        {/* ── Campañas ── */}
        <SectionTitle title="Campañas" />
        <Card style={styles.card}>
          {activaCampana ? (
            <View style={styles.campanaActiva}>
              <View style={styles.activaBadge}>
                <Text style={styles.activaBadgeText}>Activa</Text>
              </View>
              <Text style={styles.campanaName}>{activaCampana.name}</Text>
              <Text style={styles.campanaDate}>
                {fmtDate(activaCampana.startDate)} → hoy
              </Text>
            </View>
          ) : (
            <Text style={styles.muted}>Sin campaña activa</Text>
          )}
          {recentCampanas.map((c) => (
            <View key={c.id} style={styles.campanaRow}>
              <Text style={styles.campanaRowName}>{c.name}</Text>
              <Text style={styles.campanaRowDate}>
                {fmtDate(c.startDate)} → {fmtDate(c.endDate)}
              </Text>
            </View>
          ))}
        </Card>

        {/* ── Parcelas SIGPAC ── */}
        <SectionTitle title={`Parcelas (${parcelas.length})`} />
        {parcelas.length === 0 ? (
          <Text style={styles.empty}>Sin parcelas registradas.</Text>
        ) : (
          parcelas.map((p) => (
            <Card key={p.id} style={styles.parcelaCard}>
              <Text style={styles.parcelaName}>{p.name}</Text>
              {p.sigpacRef ? (
                <View style={styles.sigpacGrid}>
                  <InfoRow label="Provincia" value={String(p.sigpacRef.provincia)} />
                  <InfoRow label="Municipio" value={String(p.sigpacRef.municipio)} />
                  <InfoRow label="Polígono" value={String(p.sigpacRef.poligono)} />
                  <InfoRow label="Parcela" value={String(p.sigpacRef.parcela)} />
                  {p.sigpacRef.recinto ? (
                    <InfoRow label="Recinto" value={String(p.sigpacRef.recinto)} />
                  ) : null}
                </View>
              ) : (
                <Text style={styles.muted}>Sin referencia SIGPAC</Text>
              )}
              {p.areaHa !== null ? (
                <InfoRow label="Superficie" value={`${p.areaHa} ha`} />
              ) : null}
            </Card>
          ))
        )}

        {/* ── Tratamientos fitosanitarios (últimos 90 días) ── */}
        <SectionTitle
          title={`Fitosanitarios · últimos 90 días (${actividades.length})`}
        />
        {actividades.length === 0 ? (
          <Text style={styles.empty}>
            Sin tratamientos fitosanitarios registrados en los últimos 90 días.
          </Text>
        ) : (
          actividades.map((a) => {
            const f = a.fitosanitario!;
            return (
              <Card key={a.id} style={styles.fitoCard}>
                <View style={styles.fitoHeader}>
                  <Text style={styles.fitoDate}>{fmtDate(a.performedAt)}</Text>
                  {a.description ? (
                    <Text style={styles.fitoDesc} numberOfLines={1}>
                      {a.description}
                    </Text>
                  ) : null}
                </View>
                <InfoRow label="Producto" value={f.productoComercial} />
                <InfoRow label="Nº registro" value={f.numeroRegistro} />
                {f.materiaActiva ? (
                  <InfoRow label="Materia activa" value={f.materiaActiva} />
                ) : null}
                <InfoRow
                  label="Dosis"
                  value={`${f.dosis} ${f.dosisUnidad}`}
                />
                <InfoRow label="Plaga objetivo" value={f.plagaObjetivo} />
                <InfoRow
                  label="Plazo seguridad"
                  value={`${f.plazoSeguridadDias} días`}
                />
                {f.volumenCaldoLHa !== null && f.volumenCaldoLHa !== undefined ? (
                  <InfoRow label="Volumen caldo" value={`${f.volumenCaldoLHa} L/ha`} />
                ) : null}
                {f.operadorNombre ? (
                  <InfoRow label="Operador" value={f.operadorNombre} />
                ) : null}
                {f.operadorCarnet ? (
                  <InfoRow label="Carnet" value={f.operadorCarnet} />
                ) : null}
              </Card>
            );
          })
        )}

        {/* ── Operadores registrados ── */}
        {operators.size > 0 ? (
          <>
            <SectionTitle title="Operadores / aplicadores" />
            <Card style={styles.card}>
              {[...operators.entries()].map(([nombre, carnet]) => (
                <View key={nombre} style={styles.operadorRow}>
                  <Text style={styles.operadorName}>{nombre}</Text>
                  {carnet ? (
                    <Text style={styles.operadorCarnet}>{carnet}</Text>
                  ) : (
                    <Text style={styles.muted}>Sin carnet</Text>
                  )}
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            CampoLivo · Ficha de inspección fitosanitaria
          </Text>
          <Text style={styles.footerText}>
            Campos según RD 1311/2012 y RD 1054/2022 (SIEX/CUE)
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  errorIcon: { fontSize: 48, marginBottom: theme.spacing.md },
  errorTitle: {
    ...typography.headline,
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  errorBody: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: theme.spacing.xs,
  },
  dotOnline: { backgroundColor: theme.colors.primary },
  dotOffline: { backgroundColor: '#f59e0b' },
  statusText: { fontSize: 12, color: theme.colors.textMuted },
  exportBtn: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 44,
    alignItems: 'center',
  },
  exportBtnDisabled: { opacity: 0.6 },
  exportBtnText: {
    color: theme.colors.primaryText,
    fontSize: 13,
    fontWeight: '600',
  },

  sectionTitle: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },

  card: { marginBottom: theme.spacing.sm },
  parcelaCard: { marginBottom: theme.spacing.sm },
  fitoCard: { marginBottom: theme.spacing.sm },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  infoLabel: { ...typography.label, fontSize: 13, color: theme.colors.textMuted, flex: 1 },
  infoValue: {
    ...typography.bodyMedium,
    fontSize: 13,
    color: theme.colors.text,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },

  muted: { fontSize: 13, color: theme.colors.textMuted, fontStyle: 'italic' },
  empty: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
    lineHeight: 20,
  },

  // Campañas
  campanaActiva: { marginBottom: theme.spacing.sm },
  activaBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.primary + '20',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    marginBottom: 4,
  },
  activaBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  campanaName: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  campanaDate: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  campanaRow: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  campanaRowName: { fontSize: 13, color: theme.colors.text },
  campanaRowDate: { fontSize: 12, color: theme.colors.textMuted },

  // Parcelas
  parcelaName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  sigpacGrid: { marginVertical: theme.spacing.xs },

  // Fitosanitario
  fitoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: theme.spacing.xs,
  },
  fitoDate: { fontSize: 12, fontWeight: '600', color: theme.colors.primary },
  fitoDesc: { fontSize: 12, color: theme.colors.textMuted, flex: 1, textAlign: 'right', marginLeft: 8 },

  // Operadores
  operadorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  operadorName: { fontSize: 13, color: theme.colors.text, fontWeight: '500' },
  operadorCarnet: {
    fontSize: 12,
    color: theme.colors.textMuted,
    fontFamily: 'monospace',
  },

  // Footer
  footer: {
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    alignItems: 'center',
  },
  footerText: { fontSize: 11, color: theme.colors.textMuted, marginBottom: 2 },
});
