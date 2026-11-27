import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import type { MainStackParamList } from '@/navigation/types';
import {
  ACTIVIDAD_TYPE_LABELS,
  Actividad,
  Fitosanitario,
  actividadesService,
} from '@/services/actividades.service';
import { campanasService } from '@/services/campanas.service';
import { OfflineQueuedError } from '@/services/mutationQueue.service';
import { cancelDeadlineNotification } from '@/services/notifications.service';
import { Parcela, parcelasService } from '@/services/parcelas.service';
import {
  computePlazoFromActividad,
  formatPlazoDateEs,
} from '@/services/plazoSeguridad.service';
import { theme } from '@/theme';
import { typography } from '@/typography';
import { confirmDestructive } from '@/utils/confirm';

/** How many prior similar activities to show in the history mini-list.
 * Small cap so the detail screen stays a glance, not a scroll — the
 * full type-filtered cuaderno is one tap away. */
const HISTORY_LIMIT = 4;

type Props = NativeStackScreenProps<MainStackParamList, 'ActividadDetail'>;

const dec = (n: number) => String(n).replace('.', ',');

/** Datos del Cuaderno Digital que el usuario haya rellenado (sin huecos). */
function cdeDetailRows(f: Fitosanitario): Array<[string, string]> {
  const asesor = [f.asesorNombre, f.asesorNif, f.asesorRopo, f.asesorFechaValidacion]
    .filter(Boolean)
    .join(' · ');
  const rows: Array<[string, string | null | undefined]> = [
    ['Cultivo', [f.cultivoEspecie, f.cultivoVariedad].filter(Boolean).join(' · ')],
    ['Superficie tratada', f.superficieTratadaHa != null ? `${dec(f.superficieTratadaHa)} ha` : null],
    ['Justificación', f.justificacion],
    [
      'Cantidad utilizada',
      f.cantidadProducto != null ? `${dec(f.cantidadProducto)} ${f.cantidadUnidad ?? ''}`.trim() : null,
    ],
    ['NIF aplicador', f.operadorNif],
    ['ROPO aplicador', f.operadorRopo],
    ['Equipo', [f.equipoDescripcion, f.equipoRoma ? `ROMA ${f.equipoRoma}` : null].filter(Boolean).join(' · ')],
    ['Eficacia', f.eficacia],
    ['Asesor', asesor],
  ];
  return rows.filter((r): r is [string, string] => Boolean(r[1]));
}

function fmtEur(n: number | null): string {
  if (n === null) return '—';
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

/** Sign-suppressed (the caller adds the leading `+`/`−` glyph) percentage
 * formatter with 0 decimals — the comparison is rough by nature, more
 * decimals would imply false precision. */
function fmtPctSigned(n: number): string {
  const abs = Math.abs(n);
  return abs.toLocaleString('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function ActividadDetailScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const { actividadId } = route.params;

  const [actividad, setActividad] = useState<Actividad | null>(null);
  const [parcela, setParcela] = useState<Parcela | null>(null);
  // Resolved name of the campaña this activity is tagged to (if any).
  const [campanaName, setCampanaName] = useState<string | null>(null);
  const [history, setHistory] = useState<Actividad[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const a = await actividadesService.getById(actividadId);
      setActividad(a);
      // Resolve parcel name and same-type history in parallel; both are
      // contextual enrichments, so a failure on either side just collapses
      // that section to its empty state instead of blanking the screen.
      const [parcelaResult, historyResult] = await Promise.allSettled([
        parcelasService.getById(a.parcelaId),
        actividadesService.list({ parcelaId: a.parcelaId, type: a.type }),
      ]);
      setParcela(
        parcelaResult.status === 'fulfilled' ? parcelaResult.value : null,
      );
      if (historyResult.status === 'fulfilled') {
        // Drop the current activity from the history list (we're already
        // looking at it) and trust the backend's performedAt-desc ordering.
        // Defensive id tiebreak in case two activities share a date.
        const others = historyResult.value
          .filter((h) => h.id !== a.id)
          .sort((x, y) => {
            if (x.performedAt > y.performedAt) return -1;
            if (x.performedAt < y.performedAt) return 1;
            return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
          });
        setHistory(others);
      } else {
        setHistory([]);
      }
      // Resolve the campaña name if the activity is tagged. Best-effort —
      // a failure just collapses the row.
      if (a.campanaId) {
        try {
          const c = await campanasService.getById(a.campanaId);
          setCampanaName(c.name);
        } catch {
          setCampanaName(null);
        }
      } else {
        setCampanaName(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando actividad');
    }
  }, [actividadId]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
    // Reload on focus so returning from EditActividad shows fresh data.
    const unsub = navigation.addListener('focus', () => {
      void load();
    });
    return unsub;
  }, [load, navigation]);

  async function confirmDelete(): Promise<void> {
    if (!actividad || deleting) return;
    const ok = await confirmDestructive({
      title: 'Eliminar actividad',
      message:
        '¿Seguro que quieres eliminar esta actividad? Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
    });
    if (ok) void doDelete();
  }

  async function doDelete(): Promise<void> {
    if (!actividad) return;
    setDeleting(true);
    setError(null);
    try {
      await actividadesService.remove(actividad.id);
      // Cancel any scheduled plazo de seguridad notification — no-op if
      // this isn't a tratamiento fitosanitario or no notification was set.
      void cancelDeadlineNotification(actividad.id);
      navigation.goBack();
    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        // The DELETE was queued. We still pop back to the list — once the
        // sync runs it'll disappear from the listing on next focus reload.
        Alert.alert(
          'Eliminación pendiente',
          'Sin conexión. La eliminación se aplicará cuando vuelva internet.',
          [{ text: 'Aceptar', onPress: () => navigation.goBack() }],
        );
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo eliminar');
        setDeleting(false);
      }
    }
  }

  // Cost delta vs. the previous same-type activity on this parcela. The
  // user's mental model for "is this normal?" is the last comparable
  // event, not an average — averages smooth out the seasonal swings
  // (a poda after a heavy harvest year costs more than after a light one).
  // We surface the delta only when both sides have a recorded cost;
  // null-cost entries (observations, scouting) shouldn't anchor the
  // comparison silently to 0.
  const prevWithCost = useMemo(
    () => history.find((h) => h.costEur !== null) ?? null,
    [history],
  );
  const costDelta = useMemo(() => {
    if (!actividad || actividad.costEur === null || prevWithCost === null) {
      return null;
    }
    const prev = prevWithCost.costEur;
    if (prev === null || prev === 0) return null; // div-by-zero / no signal
    const diff = actividad.costEur - prev;
    return {
      absEur: diff,
      pct: (diff / prev) * 100,
      previousIso: prevWithCost.performedAt,
    };
  }, [actividad, prevWithCost]);

  if (loading || !actividad) {
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

  // Computed plazo de seguridad (RD 1311/2012). Pure derivation from this
  // actividad alone — no other rows needed because the plazo is anchored to
  // *this* application's date + days. Returns null on non-fitosanitario rows.
  const plazo = computePlazoFromActividad(actividad);

  return (
    <Screen>
      <ScrollView>
        <Text style={styles.title}>
          {ACTIVIDAD_TYPE_LABELS[actividad.type]}
        </Text>
        <Text style={styles.subtitle}>{actividad.performedAt}</Text>

        <Card style={styles.card}>
          {/* Parcela row is the main "exit ramp" out of this screen — the
              user often wants to see what else has happened on the same
              plot. Pressable renders only when we've actually resolved
              the parcela; otherwise the fallback id is just an inert
              label (no point navigating to a screen we couldn't load). */}
          <Pressable
            onPress={() => {
              if (!parcela) return;
              navigation.navigate('ParcelaDetail', {
                parcelaId: parcela.id,
                fincaId: route.params.fincaId,
              });
            }}
            disabled={!parcela}
            style={styles.row}
            accessibilityRole={parcela ? 'button' : undefined}
          >
            <Text style={styles.label}>Parcela</Text>
            <View style={styles.parcelaValueWrap}>
              <Text style={styles.value}>
                {parcela?.name ?? actividad.parcelaId}
              </Text>
              {parcela ? <Text style={styles.chevron}>›</Text> : null}
            </View>
          </Pressable>
          <View style={styles.row}>
            <Text style={styles.label}>Coste</Text>
            <View style={styles.parcelaValueWrap}>
              <Text style={styles.value}>{fmtEur(actividad.costEur)}</Text>
              {costDelta !== null ? (
                // Sign-aware delta. We render the % alongside the absolute
                // because both views matter: "+45 €" vs "+18 %" — the
                // grower interprets one or the other depending on whether
                // the typical magnitude is small (e.g. abonado) or large
                // (e.g. cosecha).
                <Text
                  style={[
                    styles.deltaBadge,
                    costDelta.absEur >= 0
                      ? styles.deltaBadgeUp
                      : styles.deltaBadgeDown,
                  ]}
                >
                  {costDelta.absEur >= 0 ? '+' : ''}
                  {fmtPctSigned(costDelta.pct)} % vs anterior
                </Text>
              ) : null}
            </View>
          </View>
          {actividad.campanaId ? (
            <View style={styles.row}>
              <Text style={styles.label}>Campaña</Text>
              <Text style={styles.value}>
                {campanaName ?? '—'}
              </Text>
            </View>
          ) : null}
          <View style={styles.row}>
            <Text style={styles.label}>Registrada</Text>
            <Text style={styles.value}>
              {new Date(actividad.createdAt).toLocaleString('es-ES')}
            </Text>
          </View>
        </Card>

        {actividad.description ? (
          <>
            <Text style={styles.sectionTitle}>Notas</Text>
            <Card>
              <Text style={styles.notes}>{actividad.description}</Text>
            </Card>
          </>
        ) : null}

        {/* Cuaderno fitosanitario block (RD 1311/2012). Only present on
            tratamiento_fitosanitario rows; the DB CHECK constraint guarantees
            it. Optional fields are rendered as "—" so the inspector-style
            layout stays predictable. */}
        {actividad.fitosanitario ? (
          <>
            <Text style={styles.sectionTitle}>Cuaderno fitosanitario</Text>
            <Card style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.label}>Producto</Text>
                <Text style={styles.value}>
                  {actividad.fitosanitario.productoComercial}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Nº registro</Text>
                <Text style={styles.value}>
                  {actividad.fitosanitario.numeroRegistro}
                </Text>
              </View>
              {actividad.fitosanitario.materiaActiva ? (
                <View style={styles.row}>
                  <Text style={styles.label}>Materia activa</Text>
                  <Text style={styles.value}>
                    {actividad.fitosanitario.materiaActiva}
                  </Text>
                </View>
              ) : null}
              <View style={styles.row}>
                <Text style={styles.label}>Dosis</Text>
                <Text style={styles.value}>
                  {actividad.fitosanitario.dosis.toLocaleString('es-ES', {
                    maximumFractionDigits: 3,
                  })}{' '}
                  {actividad.fitosanitario.dosisUnidad}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Plaga objetivo</Text>
                <Text style={styles.value}>
                  {actividad.fitosanitario.plagaObjetivo}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Plazo de seguridad</Text>
                <Text style={styles.value}>
                  {actividad.fitosanitario.plazoSeguridadDias}{' '}
                  {actividad.fitosanitario.plazoSeguridadDias === 1
                    ? 'día'
                    : 'días'}
                </Text>
              </View>
              {plazo ? (
                <View style={styles.row}>
                  <Text style={styles.label}>Apta a recolectar</Text>
                  <Text
                    style={[
                      styles.value,
                      plazo.activo ? styles.plazoActiveValue : styles.plazoOkValue,
                    ]}
                  >
                    {plazo.activo
                      ? `desde el ${formatPlazoDateEs(plazo.expiraEl)}` +
                        (plazo.diasRestantes <= 0
                          ? ' (vence hoy)'
                          : plazo.diasRestantes === 1
                            ? ' (vence mañana)'
                            : ` (faltan ${plazo.diasRestantes} días)`)
                      : `desde el ${formatPlazoDateEs(plazo.expiraEl)} ✓`}
                  </Text>
                </View>
              ) : null}
              {actividad.fitosanitario.volumenCaldoLHa ? (
                <View style={styles.row}>
                  <Text style={styles.label}>Volumen de caldo</Text>
                  <Text style={styles.value}>
                    {actividad.fitosanitario.volumenCaldoLHa.toLocaleString(
                      'es-ES',
                      { maximumFractionDigits: 0 },
                    )}{' '}
                    L/ha
                  </Text>
                </View>
              ) : null}
              {actividad.fitosanitario.operadorNombre ||
              actividad.fitosanitario.operadorCarnet ? (
                <View style={styles.row}>
                  <Text style={styles.label}>Operador</Text>
                  <Text style={styles.value}>
                    {actividad.fitosanitario.operadorNombre ?? '—'}
                    {actividad.fitosanitario.operadorCarnet
                      ? ` · ${actividad.fitosanitario.operadorCarnet}`
                      : ''}
                  </Text>
                </View>
              ) : null}
              {cdeDetailRows(actividad.fitosanitario).map(([label, value]) => (
                <View key={label} style={styles.row}>
                  <Text style={styles.label}>{label}</Text>
                  <Text style={styles.value}>{value}</Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {actividad.photos.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>
              Fotos ({actividad.photos.length})
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.photoRow}
            >
              {actividad.photos.map((uri) => (
                <Image
                  key={uri}
                  source={{ uri }}
                  style={styles.photo}
                />
              ))}
            </ScrollView>
          </>
        ) : null}

        {/* Same-type history on this parcela. Shown only when there's
            actually prior context — an activity that's the first of its
            kind on the plot doesn't need an empty "Sin historial" stub
            that just adds noise. */}
        {history.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>
              Historial en esta parcela ·{' '}
              {ACTIVIDAD_TYPE_LABELS[actividad.type]}
              {history.length > HISTORY_LIMIT
                ? ` · ${HISTORY_LIMIT} de ${history.length}`
                : ''}
            </Text>
            {history.slice(0, HISTORY_LIMIT).map((h) => (
              <Card
                key={h.id}
                onPress={() =>
                  navigation.navigate('ActividadDetail', {
                    actividadId: h.id,
                    fincaId: route.params.fincaId,
                  })
                }
                style={styles.historyCard}
              >
                <View style={styles.historyRow}>
                  <View style={styles.historyMain}>
                    <Text style={styles.historyDate}>{h.performedAt}</Text>
                    {h.description ? (
                      <Text style={styles.historyDesc} numberOfLines={1}>
                        {h.description}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.historyCost}>{fmtEur(h.costEur)}</Text>
                </View>
              </Card>
            ))}
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title="Editar"
          onPress={() =>
            navigation.navigate('EditActividad', {
              actividadId: actividad.id,
              fincaId: route.params.fincaId,
            })
          }
          disabled={deleting}
          style={styles.edit}
        />
        <Button
          title="Eliminar"
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
  },
  subtitle: {
    ...typography.body,
    color: theme.colors.textMuted,
    marginTop: 2,
    marginBottom: theme.spacing.md,
  },
  card: { marginBottom: theme.spacing.md },
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
  // Yellow when the plazo is still active (no recolectar), green when
  // already cumplido. Inline colours because this is the only screen using
  // these tokens; we'll promote them if a third surface needs them.
  plazoActiveValue: {
    color: '#7A5C18',
  },
  plazoOkValue: {
    color: theme.colors.primary,
  },
  parcelaValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  chevron: {
    color: theme.colors.textMuted,
    fontSize: 20,
    marginLeft: theme.spacing.xs,
  },
  deltaBadge: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
  },
  // Up = more expensive than last time. Painted red because that's the
  // cost-conscious read; "more spent" is the thing the grower wants
  // flagged. Down (cheaper than last time) is green.
  deltaBadgeUp: {
    color: theme.colors.danger,
    borderColor: theme.colors.danger,
  },
  deltaBadgeDown: {
    color: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  historyCard: {
    marginBottom: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyMain: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  historyDate: {
    color: theme.colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  historyDesc: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  historyCost: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  notes: {
    color: theme.colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  photoRow: {
    marginBottom: theme.spacing.md,
  },
  photo: {
    width: 160,
    height: 160,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    marginRight: theme.spacing.sm,
    resizeMode: 'cover',
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
