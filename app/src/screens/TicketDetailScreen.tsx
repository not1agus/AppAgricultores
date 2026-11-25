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
import { StatusPill } from '@/components/StatusPill';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import { Campana, campanasService } from '@/services/campanas.service';
import {
  Ticket,
  TicketFields,
  ticketsService,
} from '@/services/tickets.service';
import { theme } from '@/theme';
import { typography } from '@/typography';

type Props = NativeStackScreenProps<MainStackParamList, 'TicketDetail'>;

type FormState = {
  // Identificación
  numeroTicket: string;
  almazara: string;
  fecha: string;
  // Producción
  kgAceituna: string;
  kgAceite: string;
  rendimientoPct: string;
  calidad: string;
  variedad: string;
  lavada: boolean | null;
  // Económico
  totalEur: string;
  precioUnitarioEur: string;
  // Horarios
  horaInicio: string;
  horaFinal: string;
  duracion: string;
};

const EMPTY_FORM: FormState = {
  numeroTicket: '',
  almazara: '',
  fecha: '',
  kgAceituna: '',
  kgAceite: '',
  rendimientoPct: '',
  calidad: '',
  variedad: '',
  lavada: null,
  totalEur: '',
  precioUnitarioEur: '',
  horaInicio: '',
  horaFinal: '',
  duracion: '',
};

function fieldsToForm(fields: TicketFields | null | undefined): FormState {
  const f = fields ?? {};
  return {
    numeroTicket: f.numeroTicket ?? '',
    almazara: f.almazara ?? '',
    fecha: f.fecha ?? '',
    kgAceituna: f.kgAceituna?.toString() ?? '',
    kgAceite: f.kgAceite?.toString() ?? '',
    rendimientoPct: f.rendimientoPct?.toString() ?? '',
    calidad: f.calidad ?? '',
    variedad: f.variedad ?? '',
    lavada: f.lavada ?? null,
    totalEur: f.totalEur?.toString() ?? '',
    precioUnitarioEur: f.precioUnitarioEur?.toString() ?? '',
    horaInicio: f.horaInicio ?? '',
    horaFinal: f.horaFinal ?? '',
    duracion: f.duracion ?? '',
  };
}

function str(v: string): string | null {
  return v.trim().length > 0 ? v.trim() : null;
}

function parseNumberOrNull(raw: string): number | null {
  const trimmed = raw.replace(',', '.').trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function formToFields(form: FormState): TicketFields {
  return {
    numeroTicket: str(form.numeroTicket),
    almazara: str(form.almazara),
    fecha: str(form.fecha),
    kgAceituna: parseNumberOrNull(form.kgAceituna),
    kgAceite: parseNumberOrNull(form.kgAceite),
    rendimientoPct: parseNumberOrNull(form.rendimientoPct),
    calidad: str(form.calidad),
    variedad: str(form.variedad),
    lavada: form.lavada,
    totalEur: parseNumberOrNull(form.totalEur),
    precioUnitarioEur: parseNumberOrNull(form.precioUnitarioEur),
    horaInicio: str(form.horaInicio),
    horaFinal: str(form.horaFinal),
    duracion: str(form.duracion),
    currency: 'EUR',
  };
}

function fmtPctEs(n: number): string {
  return n
    .toLocaleString('es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    })
    .replace('.', ',');
}

const RENDIMIENTO_TOLERANCE_PCT = 0.5;

function confidenceLabel(c: number | null): {
  text: string;
  color: string;
} {
  if (c === null) return { text: 'OCR sin datos de confianza', color: theme.colors.textMuted };
  const pct = Math.round(c * 100);
  if (pct >= 85) return { text: `Confianza OCR alta (${pct}%)`, color: theme.colors.primary };
  if (pct >= 65) return { text: `Confianza OCR media (${pct}%)`, color: theme.colors.secondary };
  return { text: `Confianza OCR baja (${pct}%) — revisa todos los campos`, color: theme.colors.danger };
}

export function TicketDetailScreen({ route, navigation }: Props): JSX.Element {
  const { ticketId, fincaId } = route.params;

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [notes, setNotes] = useState('');
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [selectedCampanaId, setSelectedCampanaId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [t, cs] = await Promise.all([
        ticketsService.getById(ticketId),
        campanasService.listByFinca(fincaId),
      ]);
      setTicket(t);
      setForm(fieldsToForm(t.corrected ?? t.parsed));
      setNotes(t.notes ?? '');
      setCampanas(cs);
      setSelectedCampanaId(t.campanaId ?? cs[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando ticket');
    }
  }, [ticketId, fincaId]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  async function saveCorrections(): Promise<void> {
    if (!ticket || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await ticketsService.update(ticket.id, {
        corrected: formToFields(form),
        notes: notes.trim().length > 0 ? notes.trim() : null,
      });
      setTicket(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar las correcciones');
    } finally {
      setBusy(false);
    }
  }

  async function rescan(): Promise<void> {
    if (!ticket || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await ticketsService.rescan(ticket.id);
      setTicket(updated);
      setForm(fieldsToForm(updated.corrected ?? updated.parsed));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'El reescaneo OCR falló');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (!ticket || busy) return;
    if (!selectedCampanaId) {
      setError('Crea una campaña antes de confirmar el ticket.');
      return;
    }
    const amount = parseNumberOrNull(form.totalEur);
    if (amount === null) {
      setError('Introduce el importe total antes de confirmar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ticketsService.update(ticket.id, {
        corrected: formToFields(form),
        notes: notes.trim().length > 0 ? notes.trim() : null,
      });
      const confirmed = await ticketsService.confirm(ticket.id, {
        campanaId: selectedCampanaId,
        kind: 'gasto',
        category: 'almazara',
      });
      setTicket(confirmed);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(): void {
    if (!ticket || deleting || busy) return;
    const hasTx = ticket.transaccionId !== null;
    Alert.alert(
      'Eliminar ticket',
      hasTx
        ? 'Este ticket ya está confirmado como transacción. Al borrar el ticket se elimina la foto y el OCR, pero la transacción asociada se mantiene.'
        : '¿Seguro que quieres eliminar este ticket? Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => { void doDelete(); } },
      ],
    );
  }

  async function doDelete(): Promise<void> {
    if (!ticket) return;
    setDeleting(true);
    setError(null);
    try {
      await ticketsService.remove(ticket.id);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
      setDeleting(false);
    }
  }

  const canConfirm = useMemo(
    () =>
      ticket !== null &&
      ticket.transaccionId === null &&
      selectedCampanaId !== null &&
      parseNumberOrNull(form.totalEur) !== null,
    [ticket, selectedCampanaId, form.totalEur],
  );

  const computedRendimiento = useMemo(() => {
    const aceituna = parseNumberOrNull(form.kgAceituna);
    const aceite = parseNumberOrNull(form.kgAceite);
    if (aceituna === null || aceite === null) return null;
    if (aceituna <= 0) return null;
    return (aceite / aceituna) * 100;
  }, [form.kgAceituna, form.kgAceite]);

  const enteredRendimiento = useMemo(
    () => parseNumberOrNull(form.rendimientoPct),
    [form.rendimientoPct],
  );

  const rendimientoMismatch =
    computedRendimiento !== null &&
    enteredRendimiento !== null &&
    Math.abs(enteredRendimiento - computedRendimiento) > RENDIMIENTO_TOLERANCE_PCT;

  function autofillRendimiento(): void {
    if (computedRendimiento === null) return;
    setForm((prev) => ({ ...prev, rendimientoPct: fmtPctEs(computedRendimiento) }));
  }

  // Show what the OCR parsed for a field — helps the user spot corrections.
  function parsedHint(key: keyof typeof form): string | null {
    const p = ticket?.parsed;
    if (!p) return null;
    const raw = p[key as keyof TicketFields];
    if (raw === null || raw === undefined || raw === '') return null;
    return String(raw);
  }

  if (loading || !ticket) {
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

  const conf = confidenceLabel(ticket.ocrConfidence);

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Ticket</Text>
          <StatusPill status={ticket.status} />
        </View>

        {/* Image */}
        <Image source={{ uri: ticket.imageUrl }} style={styles.preview} />

        {/* OCR confidence */}
        {ticket.status === 'done' || ticket.status === 'failed' ? (
          <Text style={[styles.confidence, { color: conf.color }]}>{conf.text}</Text>
        ) : null}

        {/* Already confirmed banner */}
        {ticket.transaccionId ? (
          <Card style={styles.banner}>
            <Text style={styles.bannerText}>
              Este ticket ya está confirmado y vinculado a una transacción.
            </Text>
            <Button
              title="Ver transacción"
              variant="ghost"
              onPress={() =>
                navigation.navigate('EditTransaccion', {
                  transaccionId: ticket.transaccionId as string,
                })
              }
              style={styles.bannerAction}
            />
          </Card>
        ) : null}

        {/* ── Identificación ─────────────────────────────── */}
        <Text style={styles.sectionTitle}>Identificación</Text>
        <TextField
          label="Nº ticket"
          value={form.numeroTicket}
          onChangeText={(v) => setForm({ ...form, numeroTicket: v })}
          autoCapitalize="characters"
        />
        {parsedHint('numeroTicket') ? (
          <Text style={styles.ocrHint}>OCR: {parsedHint('numeroTicket')}</Text>
        ) : null}
        <TextField
          label="Almazara"
          value={form.almazara}
          onChangeText={(v) => setForm({ ...form, almazara: v })}
        />
        {parsedHint('almazara') ? (
          <Text style={styles.ocrHint}>OCR: {parsedHint('almazara')}</Text>
        ) : null}
        <TextField
          label="Fecha (YYYY-MM-DD)"
          value={form.fecha}
          onChangeText={(v) => setForm({ ...form, fecha: v })}
          autoCapitalize="none"
        />
        {parsedHint('fecha') ? (
          <Text style={styles.ocrHint}>OCR: {parsedHint('fecha')}</Text>
        ) : null}

        {/* ── Producción ─────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Producción</Text>
        <TextField
          label="Kg aceituna"
          value={form.kgAceituna}
          onChangeText={(v) => setForm({ ...form, kgAceituna: v })}
          keyboardType="decimal-pad"
        />
        {parsedHint('kgAceituna') ? (
          <Text style={styles.ocrHint}>OCR: {parsedHint('kgAceituna')} kg</Text>
        ) : null}
        <TextField
          label="Kg aceite"
          value={form.kgAceite}
          onChangeText={(v) => setForm({ ...form, kgAceite: v })}
          keyboardType="decimal-pad"
        />
        {parsedHint('kgAceite') ? (
          <Text style={styles.ocrHint}>OCR: {parsedHint('kgAceite')} kg</Text>
        ) : null}
        <TextField
          label="Rendimiento (%)"
          value={form.rendimientoPct}
          onChangeText={(v) => setForm({ ...form, rendimientoPct: v })}
          keyboardType="decimal-pad"
        />
        {computedRendimiento !== null ? (
          <View style={styles.rendimientoHintWrap}>
            {enteredRendimiento === null ? (
              <Pressable
                onPress={autofillRendimiento}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Usar rendimiento calculado"
              >
                <Text style={styles.rendimientoHintLink}>
                  Calculado: {fmtPctEs(computedRendimiento)} % · pulsar para rellenar
                </Text>
              </Pressable>
            ) : rendimientoMismatch ? (
              <Text style={styles.rendimientoHintWarn}>
                Calculado: {fmtPctEs(computedRendimiento)} % — no coincide con el introducido.
              </Text>
            ) : (
              <Text style={styles.rendimientoHintText}>
                Calculado: {fmtPctEs(computedRendimiento)} % (coincide).
              </Text>
            )}
          </View>
        ) : null}
        <TextField
          label="Calidad"
          value={form.calidad}
          onChangeText={(v) => setForm({ ...form, calidad: v })}
        />
        {parsedHint('calidad') ? (
          <Text style={styles.ocrHint}>OCR: {parsedHint('calidad')}</Text>
        ) : null}
        <TextField
          label="Variedad"
          value={form.variedad}
          onChangeText={(v) => setForm({ ...form, variedad: v })}
        />
        {parsedHint('variedad') ? (
          <Text style={styles.ocrHint}>OCR: {parsedHint('variedad')}</Text>
        ) : null}

        {/* Lavada boolean */}
        <Text style={styles.fieldLabel}>Lavada</Text>
        <View style={styles.chips}>
          {([true, false, null] as Array<boolean | null>).map((v) => {
            const label = v === null ? 'Sin datos' : v ? 'Sí' : 'No';
            const selected = form.lavada === v;
            return (
              <Text
                key={label}
                onPress={() => setForm({ ...form, lavada: v })}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                {label}
              </Text>
            );
          })}
        </View>
        {ticket.parsed?.lavada !== undefined && ticket.parsed.lavada !== null ? (
          <Text style={styles.ocrHint}>OCR: {ticket.parsed.lavada ? 'Sí' : 'No'}</Text>
        ) : null}

        {/* ── Económico ──────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Económico</Text>
        <TextField
          label="Total (€)"
          value={form.totalEur}
          onChangeText={(v) => setForm({ ...form, totalEur: v })}
          keyboardType="decimal-pad"
        />
        {parsedHint('totalEur') ? (
          <Text style={styles.ocrHint}>OCR: {parsedHint('totalEur')} €</Text>
        ) : null}
        <TextField
          label="Precio/kg (€)"
          value={form.precioUnitarioEur}
          onChangeText={(v) => setForm({ ...form, precioUnitarioEur: v })}
          keyboardType="decimal-pad"
        />
        {parsedHint('precioUnitarioEur') ? (
          <Text style={styles.ocrHint}>OCR: {parsedHint('precioUnitarioEur')} €/kg</Text>
        ) : null}

        {/* ── Horarios ───────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Horarios</Text>
        <TextField
          label="Hora entrada"
          value={form.horaInicio}
          onChangeText={(v) => setForm({ ...form, horaInicio: v })}
          autoCapitalize="none"
        />
        <TextField
          label="Hora salida"
          value={form.horaFinal}
          onChangeText={(v) => setForm({ ...form, horaFinal: v })}
          autoCapitalize="none"
        />
        <TextField
          label="Duración"
          value={form.duracion}
          onChangeText={(v) => setForm({ ...form, duracion: v })}
          autoCapitalize="none"
        />

        {/* ── Notas ──────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Notas</Text>
        <TextField
          label="Notas (opcionales)"
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        {/* Actions */}
        <View style={styles.actionsRow}>
          <Button
            title="Guardar"
            variant="ghost"
            onPress={saveCorrections}
            disabled={busy}
            style={styles.flex}
          />
          <View style={{ width: theme.spacing.sm }} />
          <Button
            title="Reescanear"
            variant="ghost"
            onPress={rescan}
            disabled={busy}
            style={styles.flex}
          />
        </View>

        {/* ── Campaña ────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Campaña</Text>
        {campanas.length === 0 ? (
          <Text style={styles.empty}>
            No hay campañas en esta finca. Crea una para poder confirmar el ticket.
          </Text>
        ) : (
          <View style={styles.chips}>
            {campanas.map((c) => {
              const selected = c.id === selectedCampanaId;
              return (
                <Text
                  key={c.id}
                  onPress={() => setSelectedCampanaId(c.id)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  {c.name}
                </Text>
              );
            })}
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title={ticket.transaccionId ? 'Ya confirmado' : 'Confirmar como gasto'}
          onPress={confirm}
          loading={busy}
          disabled={!canConfirm || busy}
          style={styles.confirm}
        />

        {/* Raw OCR text */}
        {ticket.ocrRawText ? (
          <>
            <Text style={styles.sectionTitle}>Texto OCR bruto</Text>
            <Card>
              <Text style={styles.rawText}>{ticket.ocrRawText}</Text>
            </Card>
          </>
        ) : null}

        <Button
          title="Eliminar ticket"
          variant="ghost"
          onPress={confirmDelete}
          loading={deleting}
          disabled={busy}
          style={styles.delete}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  title: {
    ...typography.display,
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
  },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    marginBottom: theme.spacing.sm,
    resizeMode: 'cover',
  },
  confidence: {
    ...typography.label,
    fontSize: 12,
    marginBottom: theme.spacing.md,
  },
  banner: { marginBottom: theme.spacing.md },
  bannerText: { color: theme.colors.text },
  bannerAction: { marginTop: theme.spacing.sm, alignSelf: 'flex-start' },
  sectionTitle: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  fieldLabel: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  ocrHint: {
    ...typography.label,
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: -theme.spacing.sm,
    marginBottom: theme.spacing.xs,
    paddingHorizontal: 2,
  },
  rendimientoHintWrap: {
    marginTop: -theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    paddingHorizontal: 2,
  },
  rendimientoHintText: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  rendimientoHintLink: {
    ...typography.label,
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  rendimientoHintWarn: {
    ...typography.label,
    color: theme.colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  actionsRow: { flexDirection: 'row', marginTop: theme.spacing.sm },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: theme.spacing.xs },
  chip: {
    ...typography.label,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    marginRight: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
    overflow: 'hidden',
    fontSize: 13,
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    color: theme.colors.primaryText,
  },
  confirm: { marginTop: theme.spacing.md },
  empty: { color: theme.colors.textMuted },
  error: { color: theme.colors.danger, marginTop: theme.spacing.sm },
  rawText: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: theme.colors.text,
  },
  delete: {
    marginTop: theme.spacing.lg,
    borderColor: theme.colors.danger,
  },
});
