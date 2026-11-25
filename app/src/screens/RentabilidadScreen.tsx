import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
  CampanaWithSummary,
  fetchFincaFinanceStats,
  FincaFinanceStats,
} from '@/services/fincaFinanceStats.service';
import { theme } from '@/theme';
import { typography } from '@/typography';
import { fmtDate } from '@/utils/date';

type Props = NativeStackScreenProps<MainStackParamList, 'Rentabilidad'>;

function fmtEur(n: number): string {
  return (
    n.toLocaleString('es-ES', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }) + ' €'
  );
}

function fmtPct(n: number): string {
  return (
    n.toLocaleString('es-ES', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + ' %'
  );
}

// ─── Campaign card ────────────────────────────────────────────────────────────

function CampanaCard({
  cs,
  onPress,
}: {
  cs: CampanaWithSummary;
  onPress: () => void;
}): JSX.Element {
  const { campana, summary } = cs;
  const margen =
    summary.totalIngresos > 0
      ? (summary.balance / summary.totalIngresos) * 100
      : null;
  const isOpen = campana.endDate === null;

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={styles.campanaCard}>
        <View style={styles.campanaHeader}>
          <Text style={styles.campanaName} numberOfLines={1}>
            {campana.name}
          </Text>
          {isOpen ? (
            <View style={styles.activaBadge}>
              <Text style={styles.activaBadgeText}>Activa</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.campanaDate}>
          {fmtDate(campana.startDate)}
          {campana.endDate ? ` → ${fmtDate(campana.endDate)}` : ' → hoy'}
        </Text>

        <View style={styles.campanaKpis}>
          <View style={styles.campanaKpiCell}>
            <Text style={styles.campanaKpiLabel}>Ingresos</Text>
            <Text style={[styles.campanaKpiValue, styles.colorIngreso]}>
              {fmtEur(summary.totalIngresos)}
            </Text>
          </View>
          <View style={styles.campanaKpiCell}>
            <Text style={styles.campanaKpiLabel}>Gastos</Text>
            <Text style={[styles.campanaKpiValue, styles.colorGasto]}>
              {fmtEur(summary.totalGastos)}
            </Text>
          </View>
          <View style={styles.campanaKpiCell}>
            <Text style={styles.campanaKpiLabel}>Balance</Text>
            <Text
              style={[
                styles.campanaKpiValue,
                summary.balance >= 0 ? styles.colorIngreso : styles.colorGasto,
              ]}
            >
              {summary.balance >= 0 ? '+' : ''}
              {fmtEur(summary.balance)}
            </Text>
          </View>
          {margen !== null ? (
            <View style={styles.campanaKpiCell}>
              <Text style={styles.campanaKpiLabel}>Margen</Text>
              <Text
                style={[
                  styles.campanaKpiValue,
                  margen >= 0 ? styles.colorIngreso : styles.colorGasto,
                ]}
              >
                {margen >= 0 ? '+' : ''}
                {fmtPct(margen)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Mini ratio bar per campaign */}
        {summary.totalIngresos > 0 ? (
          <View style={styles.miniBarTrack}>
            <View
              style={[
                styles.miniBarFill,
                {
                  width: `${Math.min((summary.totalGastos / summary.totalIngresos) * 100, 100)}%`,
                },
              ]}
            />
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function RentabilidadScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const { fincaId } = route.params;

  const [stats, setStats] = useState<FincaFinanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const data = await fetchFincaFinanceStats(fincaId);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando datos');
    }
  }, [fincaId]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh(): Promise<void> {
    setRefreshing(true);
    await load();
    setRefreshing(false);
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

  if (error || !stats) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.error}>{error ?? 'Sin datos'}</Text>
        </View>
      </Screen>
    );
  }

  const { totalIngresos, totalGastos, balance } = stats;
  const margenNeto =
    totalIngresos > 0 ? (balance / totalIngresos) * 100 : null;
  const gastoRatio =
    totalIngresos > 0 ? Math.min(totalGastos / totalIngresos, 1) : 0;

  return (
    <Screen>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* ── Aggregate KPI card ── */}
        <Card style={styles.kpiCard}>
          <Text style={styles.kpiCardTitle}>Total acumulado</Text>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCell}>
              <Text style={styles.kpiLabel}>Ingresos</Text>
              <Text style={[styles.kpiValue, styles.colorIngreso]}>
                {fmtEur(totalIngresos)}
              </Text>
            </View>
            <View style={styles.kpiDivider} />
            <View style={styles.kpiCell}>
              <Text style={styles.kpiLabel}>Gastos</Text>
              <Text style={[styles.kpiValue, styles.colorGasto]}>
                {fmtEur(totalGastos)}
              </Text>
            </View>
            <View style={styles.kpiDivider} />
            <View style={styles.kpiCell}>
              <Text style={styles.kpiLabel}>Balance</Text>
              <Text
                style={[
                  styles.kpiValue,
                  balance >= 0 ? styles.colorIngreso : styles.colorGasto,
                ]}
              >
                {balance >= 0 ? '+' : ''}
                {fmtEur(balance)}
              </Text>
            </View>
          </View>

          {/* Ratio bar: proportion of ingresos consumed by gastos */}
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                { width: `${gastoRatio * 100}%` },
              ]}
            />
          </View>
          <View style={styles.barLabels}>
            <Text style={styles.barLabelLeft}>
              {totalIngresos > 0
                ? `${fmtPct((1 - gastoRatio) * 100)} libre de gastos`
                : 'Sin ingresos registrados'}
            </Text>
            {margenNeto !== null ? (
              <Text
                style={[
                  styles.barLabelRight,
                  margenNeto >= 0 ? styles.colorIngreso : styles.colorGasto,
                ]}
              >
                Margen neto {margenNeto >= 0 ? '+' : ''}
                {fmtPct(margenNeto)}
              </Text>
            ) : null}
          </View>
        </Card>

        {/* ── Per-campaign list ── */}
        <Text style={styles.sectionTitle}>
          Por campaña ({stats.campanas.length})
        </Text>

        {stats.campanas.length === 0 ? (
          <Text style={styles.empty}>
            Crea una campaña y registra movimientos para ver el análisis de
            rentabilidad.
          </Text>
        ) : (
          stats.campanas.map((cs) => (
            <CampanaCard
              key={cs.campana.id}
              cs={cs}
              onPress={() =>
                navigation.navigate('CampanaDetail', {
                  campanaId: cs.campana.id,
                  campanaName: cs.campana.name,
                })
              }
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: theme.colors.danger },

  // Colors
  colorIngreso: { color: theme.colors.primary },
  colorGasto: { color: theme.colors.danger },

  // Aggregate KPI card
  kpiCard: { marginBottom: theme.spacing.md },
  kpiCardTitle: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.sm,
  },
  kpiRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  kpiCell: { flex: 1, alignItems: 'center' },
  kpiDivider: {
    width: 1,
    height: 36,
    backgroundColor: theme.colors.border,
  },
  kpiLabel: {
    ...typography.label,
    fontSize: 12,
    color: theme.colors.textMuted,
    marginBottom: 2,
  },
  kpiValue: {
    ...typography.display,
    fontSize: 18,
    fontWeight: '700',
  },

  // Ratio bar
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.border,
    marginTop: theme.spacing.md,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: theme.colors.danger,
  },
  barLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xs,
  },
  barLabelLeft: { fontSize: 11, color: theme.colors.textMuted },
  barLabelRight: { fontSize: 11, fontWeight: '600' },

  // Section
  sectionTitle: {
    ...typography.headline,
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  empty: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
    lineHeight: 22,
  },

  // Campaign cards
  campanaCard: { marginBottom: theme.spacing.sm },
  campanaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  campanaName: {
    ...typography.headline,
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  },
  activaBadge: {
    backgroundColor: theme.colors.primary + '20',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
  },
  activaBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  campanaDate: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
  },
  campanaKpis: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  campanaKpiCell: { minWidth: 72 },
  campanaKpiLabel: {
    ...typography.label,
    fontSize: 11,
    color: theme.colors.textMuted,
    marginBottom: 1,
  },
  campanaKpiValue: {
    ...typography.headline,
    fontSize: 14,
    fontWeight: '700',
  },
  miniBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border,
    marginTop: theme.spacing.sm,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: theme.colors.danger,
  },
});
