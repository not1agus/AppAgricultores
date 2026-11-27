import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { NetworkError } from '@/services/api';
import {
  CdePreview,
  CdeProblem,
  cdeExportService,
} from '@/services/cdeExport.service';
import { theme } from '@/theme';
import { fmtDate } from '@/utils/date';

const MAX_TRATAMIENTOS = 500;

type AiState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error'; text: string };

interface Props {
  visible: boolean;
  fincaId: string;
  /** Tratamientos fitosanitarios visibles con los filtros actuales. */
  actividadIds: string[];
  onClose: () => void;
  onFix: (problem: CdeProblem) => void;
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof NetworkError) return 'Sin conexión. La exportación al CDE necesita internet.';
  return err instanceof Error ? err.message : fallback;
}

export function CdeExportModal({
  visible,
  fincaId,
  actividadIds,
  onClose,
  onFix,
}: Props): JSX.Element {
  const [preview, setPreview] = useState<CdePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [showRows, setShowRows] = useState(false);
  const [ai, setAi] = useState<AiState>({ status: 'idle' });

  const idsKey = actividadIds.join(',');

  const runAiReview = useCallback(async (): Promise<void> => {
    setAi({ status: 'loading' });
    try {
      const { review } = await cdeExportService.review(fincaId, actividadIds);
      setAi({ status: 'done', text: review });
    } catch (err) {
      setAi({ status: 'error', text: errorText(err, 'La revisión IA no está disponible.') });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fincaId, idsKey]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setPreview(null);
    setError(null);
    setShowRows(false);
    setAi({ status: 'idle' });

    if (actividadIds.length === 0) {
      setError('No hay tratamientos fitosanitarios en el periodo seleccionado.');
      return;
    }
    if (actividadIds.length > MAX_TRATAMIENTOS) {
      setError(`Hay más de ${MAX_TRATAMIENTOS} tratamientos. Acota el periodo para exportar.`);
      return;
    }

    setLoading(true);
    cdeExportService
      .preview(fincaId, actividadIds)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        if (p.problems.length === 0) void runAiReview();
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err, 'No se pudo preparar la exportación.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, fincaId, idsKey]);

  async function handleShare(): Promise<void> {
    if (!preview) return;
    setSharing(true);
    setError(null);
    try {
      await cdeExportService.share(preview);
    } catch (err) {
      setError(errorText(err, 'No se pudo compartir el fichero.'));
    } finally {
      setSharing(false);
    }
  }

  const blockedCount = preview
    ? new Set(preview.problems.map((p) => p.actividadId)).size
    : 0;
  const canExport = preview !== null && preview.csv !== null && preview.problems.length === 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Exportar al Cuaderno Digital (CDE)</Text>
          <Text style={styles.subtitle}>
            {actividadIds.length} tratamiento(s) fitosanitario(s) del periodo seleccionado.
          </Text>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {loading ? <ActivityIndicator color={theme.colors.primary} /> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {preview && preview.problems.length > 0 ? (
              <View style={styles.blockBox}>
                <Text style={styles.blockTitle}>
                  Faltan datos obligatorios en {blockedCount} tratamiento(s)
                </Text>
                <Text style={styles.blockHint}>
                  No se exporta nada hasta completarlos: la app no rellena datos por ti.
                </Text>
                {preview.problems.map((p) => (
                  <View key={`${p.actividadId}-${p.fixIn}`} style={styles.problem}>
                    <Text style={styles.problemHeader}>
                      {fmtDate(p.fecha)} · {p.parcelaName || 'Parcela'}
                      {p.producto ? ` · ${p.producto}` : ''}
                    </Text>
                    {p.messages.map((m) => (
                      <Text key={m} style={styles.problemMsg}>• {m}</Text>
                    ))}
                    <Button
                      title={p.fixIn === 'parcela' ? 'Completar parcela' : 'Completar tratamiento'}
                      variant="secondary"
                      onPress={() => onFix(p)}
                      style={styles.fixButton}
                    />
                  </View>
                ))}
              </View>
            ) : null}

            {preview && canExport ? (
              <>
                <View style={styles.okBox}>
                  <Text style={styles.okText}>
                    ✓ Todos los datos obligatorios están completos ({preview.rows.length}{' '}
                    tratamiento(s), {preview.columns.length} campos por tratamiento).
                  </Text>
                </View>

                <Text style={styles.sectionTitle}>Revisión con IA</Text>
                <Text style={styles.hint}>
                  Orientativa: busca incoherencias, no cambia ni rellena datos. No se envían NIF ni
                  nombres de personas.
                </Text>
                {ai.status === 'loading' ? (
                  <ActivityIndicator color={theme.colors.primary} />
                ) : null}
                {ai.status === 'done' ? <Text style={styles.aiText}>{ai.text}</Text> : null}
                {ai.status === 'error' ? (
                  <>
                    <Text style={styles.error}>{ai.text}</Text>
                    <Button title="Reintentar revisión" variant="ghost" onPress={() => void runAiReview()} />
                  </>
                ) : null}

                <Text
                  style={styles.toggle}
                  onPress={() => setShowRows((v) => !v)}
                >
                  {showRows ? 'Ocultar' : 'Ver'} los datos que se van a exportar
                </Text>
                {showRows
                  ? preview.rows.map((row, i) => (
                      <View key={i} style={styles.rowCard}>
                        {preview.columns.map((c, j) => (
                          <Text key={c} style={styles.rowLine}>
                            <Text style={styles.rowLabel}>{c}: </Text>
                            {row[j] ? row[j] : '—'}
                          </Text>
                        ))}
                      </View>
                    ))
                  : null}

                <Text style={styles.hint}>
                  El fichero solo contiene datos que has introducido tú. Súbelo al cuaderno digital
                  de tu comunidad autónoma y comprueba la importación.
                </Text>
              </>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Button title="Cerrar" variant="ghost" onPress={onClose} style={styles.flex} />
            <View style={{ width: theme.spacing.sm }} />
            <Button
              title="Exportar CSV"
              onPress={() => void handleShare()}
              loading={sharing}
              disabled={!canExport}
              style={styles.flex}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.spacing.md,
    maxHeight: '90%',
  },
  title: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  subtitle: { color: theme.colors.textMuted, marginTop: theme.spacing.xs },
  body: { marginTop: theme.spacing.md },
  bodyContent: { paddingBottom: theme.spacing.md },
  error: { color: theme.colors.danger, marginBottom: theme.spacing.sm },
  blockBox: {
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    backgroundColor: '#FBEAEA',
  },
  blockTitle: { color: theme.colors.danger, fontWeight: '700' },
  blockHint: { color: theme.colors.text, fontSize: 12, marginTop: 2, marginBottom: theme.spacing.sm },
  problem: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  problemHeader: { fontWeight: '700', color: theme.colors.text, marginBottom: 4 },
  problemMsg: { color: theme.colors.text, fontSize: 13, marginBottom: 2 },
  fixButton: { marginTop: theme.spacing.sm },
  okBox: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    backgroundColor: '#EEF3E4',
  },
  okText: { color: theme.colors.primary, fontWeight: '600' },
  sectionTitle: {
    fontWeight: '700',
    color: theme.colors.text,
    marginTop: theme.spacing.md,
  },
  hint: { color: theme.colors.textMuted, fontSize: 12, marginVertical: theme.spacing.xs },
  aiText: { color: theme.colors.text, fontSize: 14, lineHeight: 20 },
  toggle: {
    color: theme.colors.primary,
    fontWeight: '600',
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  rowCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  rowLine: { fontSize: 12, color: theme.colors.text, marginBottom: 1 },
  rowLabel: { color: theme.colors.textMuted },
  actions: { flexDirection: 'row', marginTop: theme.spacing.sm },
  flex: { flex: 1 },
});
