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

type Props = NativeStackScreenProps<MainStackParamList, 'TicketDetail'>;

type FormState = {
  almazara: string;
  fecha: string;
  kgAceituna: string;
  kgAceite: string;
  rendimientoPct: string;
  totalEur: string;
};

const EMPTY_FORM: FormState = {
  almazara: '',
  fecha: '',
  kgAceituna: '',
  kgAceite: '',
  rendimientoPct: '',
  totalEur: '',
};

function fieldsToForm(fields: TicketFields | null | undefined): FormState {
  const f = fields ?? {};
  return {
    almazara: f.almazara ?? '',
    fecha: f.fecha ?? '',
    kgAceituna: f.kgAceituna?.toString() ?? '',
    kgAceite: f.kgAceite?.toString() ?? '',
    rendimientoPct: f.rendimientoPct?.toString() ?? '',
    totalEur: f.totalEur?.toString() ?? '',
  };
}

function parseNumberOrNull(raw: string): number | null {
  const trimmed = raw.replace(',', '.').trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function formToFields(form: FormState): TicketFields {
  return {
    almazara: form.almazara.trim().length > 0 ? form.almazara.trim() : null,
    fecha: form.fecha.trim().length > 0 ? form.fecha.trim() : null,
    kgAceituna: parseNumberOrNull(form.kgAceituna),
    kgAceite: parseNumberOrNull(form.kgAceite),
    rendimientoPct: parseNumberOrNull(form.rendimientoPct),
    totalEur: parseNumberOrNull(form.totalEur),
    currency: 'EUR',
  };
}

/** Format a percentage with 2 decimals, Spanish style (comma decimal) —
 * matches what the user types in the field so a tap-to-fill round-trips
 * without surprise. */
function fmtPctEs(n: number): string {
  return n
    .toLocaleString('es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    })
    .replace('.', ',');
}

/** Threshold (in absolute %) above which the user-entered rendimiento and
 * the kg-derived value are flagged as a discrepancy. 0.5 pp swallows
 * normal rounding noise — almazara tickets rarely report kg with more
 * precision than the integer kilo, so derived rendimiento can drift
 * ~0.1-0.2 pp purely from rounding. Anything bigger is worth surfacing. */
const RENDIMIENTO_TOLERANCE_PCT = 0.5;

export function TicketDetailScreen({ route, navigation }: Props): JSX.Element {
  const { ticketId, fincaId } = route.params;

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [selectedCampanaId, setSelectedCampanaId] = useState<string | null>(
    null,
  );

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [t, cs] = await Promise.all([
        ticketsService.getById(ticketId),
        campanasService.listByFinca(fincaId),
      ]);
      setTicket(t);
      setForm(fieldsToForm(t.corrected ?? t.parsed));
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
      // Save latest corrections first so the backend derives values from them.
      await ticketsService.update(ticket.id, {
        corrected: formToFields(form),
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
        ? 'Este ticket ya está confirmado como transacción. Al borrar el ticket se elimina la foto y el OCR, pero la transacción asociada se mantiene (puedes borrarla aparte desde la campaña).'
        : '¿Seguro que quieres eliminar este ticket? Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void doDelete();
          },
        },
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

  // Rendimiento (% kg aceite / kg aceituna) is the headline KPI for any
  // almazara visit. We derive it on the fly so the user gets a sanity
  // check against their typed value, and a one-tap autofill when the
  // field is empty — entering it manually is a redundant calculator
  // session today.
  const computedRendimiento = useMemo(() => {
    const aceituna = parseNumberOrNull(form.kgAceituna);
    const aceite = parseNumberOrNull(form.kgAceite);
    if (aceituna === null || aceite === null) return null;
    if (aceituna <= 0) return null; // div-by-zero / nonsensical input
    return (aceite / aceituna) * 100;
  }, [form.kgAceituna, form.kgAceite]);

  const enteredRendimiento = useMemo(
    () => parseNumberOrNull(form.rendimientoPct),
    [form.rendimientoPct],
  );

  // Discrepancy flag only meaningful when both values are present; if
  // the user hasn't typed anything we offer autofill instead.
  const rendimientoMismatch =
    computedRendimiento !== null &&
    enteredRendimiento !== null &&
    Math.abs(enteredRendimiento - computedRendimiento) >
      RENDIMIENTO_TOLERANCE_PCT;

  function autofillRendimiento(): void {
    if (computedRendimiento === null) return;
    setForm((prev) => ({
      ...prev,
      rendimientoPct: fmtPctEs(computedRendimiento),
    }));
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

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Ticket</Text>
          <StatusPill status={ticket.status} />
        </View>

        <Image source={{ uri: ticket.imageUrl }} style={styles.preview} />

        {ticket.transaccionId ? (
          <Card style={styles.banner}>
            <Text style={styles.bannerText}>
              Este ticket ya está confirmado y vinculado a una transacción.
            </Text>
            {/* Single-tap escape from the dead-end the previous version
                created: the user landed here from the tickets list to
                review the original, and now needs to jump to the linked
                movement (to fix a date, add notes, or just verify) without
                having to navigate Finca → Campañas → find the right
                transaction by hand. */}
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

        <Text style={styles.sectionTitle}>Campos detectados</Text>
        <TextField label="Almazara" value={form.almazara} onChangeText={(v) => setForm({ ...form, almazara: v })} />
        <TextField
          label="Fecha (YYYY-MM-DD)"
          value={form.fecha}
          onChangeText={(v) => setForm({ ...form, fecha: v })}
          autoCapitalize="none"
        />
        <TextField
          label="Kg aceituna"
          value={form.kgAceituna}
          onChangeText={(v) => setForm({ ...form, kgAceituna: v })}
          keyboardType="decimal-pad"
        />
        <TextField
          label="Kg aceite"
          value={form.kgAceite}
          onChangeText={(v) => setForm({ ...form, kgAceite: v })}
          keyboardType="decimal-pad"
        />
        <TextField
          label="Rendimiento (%)"
          value={form.rendimientoPct}
          onChangeText={(v) => setForm({ ...form, rendimientoPct: v })}
          keyboardType="decimal-pad"
        />
        {computedRendimiento !== null ? (
          <View style={styles.rendimientoHintWrap}>
            {enteredRendimiento === null ? (
              // Empty field + both kg known → offer one-tap autofill so
              // the user doesn't have to compute aceite/aceituna×100 in
              // their head every time.
              <Pressable
                onPress={autofillRendimiento}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Usar rendimiento calculado"
              >
                <Text style={styles.rendimientoHintLink}>
                  Calculado: {fmtPctEs(computedRendimiento)} % · pulsar para
                  rellenar
                </Text>
              </Pressable>
            ) : rendimientoMismatch ? (
              // Both present and they disagree beyond rounding noise — the
              // ticket OCR likely got one of the two kg figures wrong, or
              // the user typed a stale value. Surfacing the mismatch is
              // worth more than silently trusting the user.
              <Text style={styles.rendimientoHintWarn}>
                Calculado: {fmtPctEs(computedRendimiento)} % — no coincide
                con el valor introducido.
              </Text>
            ) : (
              <Text style={styles.rendimientoHintText}>
                Calculado: {fmtPctEs(computedRendimiento)} % (coincide).
              </Text>
            )}
          </View>
        ) : null}
        <TextField
          label="Total (€)"
          value={form.totalEur}
          onChangeText={(v) => setForm({ ...form, totalEur: v })}
          keyboardType="decimal-pad"
        />

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

        <Text style={styles.sectionTitle}>Campaña</Text>
        {campanas.length === 0 ? (
          <Text style={styles.empty}>
            No hay campañas en esta finca. Crea una para poder confirmar el
            ticket como transacción.
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

        {ticket.ocrRawText ? (
          <>
            <Text style={styles.sectionTitle}>Texto OCR</Text>
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
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
  },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
    resizeMode: 'cover',
  },
  banner: { marginBottom: theme.spacing.md },
  bannerText: { color: theme.colors.text },
  bannerAction: {
    marginTop: theme.spacing.sm,
    alignSelf: 'flex-start',
  },
  rendimientoHintWrap: {
    marginTop: -theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    paddingHorizontal: 2,
  },
  rendimientoHintText: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  rendimientoHintLink: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  rendimientoHintWarn: {
    color: theme.colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  actionsRow: { flexDirection: 'row', marginTop: theme.spacing.sm },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
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
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    color: theme.colors.primaryText,
  },
  confirm: { marginTop: theme.spacing.md },
  empty: {
    color: theme.colors.textMuted,
  },
  error: {
    color: theme.colors.danger,
    marginTop: theme.spacing.sm,
  },
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
