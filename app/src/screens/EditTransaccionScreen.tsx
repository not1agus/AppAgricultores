import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import { OfflineQueuedError } from '@/services/mutationQueue.service';
import {
  Transaccion,
  TransaccionKind,
  transaccionesService,
} from '@/services/transacciones.service';
import { theme } from '@/theme';
import { typography } from '@/typography';
import { confirmDestructive } from '@/utils/confirm';

type Props = NativeStackScreenProps<MainStackParamList, 'EditTransaccion'>;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const INGRESO_CATEGORIES = [
  'Venta aceite',
  'Subvención PAC',
  'Ayuda',
  'Otro ingreso',
];

const GASTO_CATEGORIES = [
  'Almazara',
  'Fertilizante',
  'Tratamiento',
  'Mano de obra',
  'Combustible',
  'Maquinaria',
  'Otro gasto',
];

function parseEsNumber(raw: string): number | null {
  const trimmed = raw.replace(',', '.').trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Same input-sanitiser as CreateTransaccionScreen — duplicated here on
 * purpose to avoid a circular service boundary. If a third surface needs
 * the same logic, promote to `@/utils/numberInput.ts`. */
function sanitizeAmountInput(raw: string): string {
  let cleaned = raw.replace(/[^0-9.,]/g, '');
  const firstSepIdx = cleaned.search(/[.,]/);
  if (firstSepIdx !== -1) {
    const before = cleaned.slice(0, firstSepIdx + 1);
    const after = cleaned.slice(firstSepIdx + 1).replace(/[.,]/g, '');
    cleaned = before + after;
  }
  return cleaned;
}

function formatEsNumber(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

export function EditTransaccionScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const { transaccionId } = route.params;

  const [original, setOriginal] = useState<Transaccion | null>(null);
  const [kind, setKind] = useState<TransaccionKind>('gasto');
  const [category, setCategory] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const t = await transaccionesService.getById(transaccionId);
        if (cancelled) return;
        setOriginal(t);
        setKind(t.kind);
        setCategory(t.category);
        setOccurredAt(t.occurredAt);
        setAmountStr(formatEsNumber(t.amountEur));
        setDescription(t.description ?? '');
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'Error cargando movimiento.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transaccionId]);

  function validate(): string | null {
    if (category.trim().length === 0) return 'Indica una categoría.';
    if (!ISO_RE.test(occurredAt))
      return 'Fecha en formato AAAA-MM-DD (p. ej. 2026-04-22).';
    const amount = parseEsNumber(amountStr);
    if (amount === null) return 'Importe inválido.';
    if (amount < 0) return 'El importe no puede ser negativo.';
    return null;
  }

  async function handleSave(): Promise<void> {
    if (saving || !original) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const amount = parseEsNumber(amountStr) ?? 0;
      const trimmedDesc = description.trim();
      // Send `null` to clear an existing description, omit if empty stayed
      // empty (no-op patch). Mirrors the backend's nullable patch shape.
      const descriptionPatch: string | null | undefined =
        trimmedDesc.length === 0
          ? original.description === null
            ? undefined
            : null
          : trimmedDesc;
      await transaccionesService.update(transaccionId, {
        kind,
        category: category.trim(),
        occurredAt,
        amountEur: amount,
        ...(descriptionPatch !== undefined
          ? { description: descriptionPatch }
          : {}),
      });
      navigation.goBack();
    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        Alert.alert(
          'Guardado para sincronizar',
          'Sin conexión. Los cambios se enviarán cuando vuelva internet.',
          [{ text: 'Aceptar', onPress: () => navigation.goBack() }],
        );
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo guardar.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (deleting) return;
    const ok = await confirmDestructive({
      title: 'Eliminar movimiento',
      message:
        '¿Seguro que quieres eliminar este movimiento? Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
    });
    if (ok) void doDelete();
  }

  async function doDelete(): Promise<void> {
    setDeleting(true);
    setError(null);
    try {
      await transaccionesService.remove(transaccionId);
      navigation.goBack();
    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        Alert.alert(
          'Eliminación pendiente',
          'Sin conexión. La eliminación se aplicará cuando vuelva internet.',
          [{ text: 'Aceptar', onPress: () => navigation.goBack() }],
        );
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo eliminar.');
        setDeleting(false);
      }
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

  if (!original) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.error}>{error ?? 'Movimiento no encontrado.'}</Text>
        </View>
      </Screen>
    );
  }

  const suggestions =
    kind === 'ingreso' ? INGRESO_CATEGORIES : GASTO_CATEGORIES;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.label}>Tipo</Text>
        <View style={styles.kindRow}>
          <Text
            onPress={() => {
              if (kind !== 'ingreso') {
                setKind('ingreso');
                // Vaciamos categoría: los chips/listas de sugerencias son
                // distintas para ingreso vs gasto y mantenerla podría
                // confundir (p. ej. "Almazara" como ingreso).
                setCategory('');
              }
            }}
            style={[
              styles.kindChip,
              kind === 'ingreso' && styles.kindChipIngresoSelected,
            ]}
          >
            Ingreso
          </Text>
          <Text
            onPress={() => {
              if (kind !== 'gasto') {
                setKind('gasto');
                setCategory('');
              }
            }}
            style={[
              styles.kindChip,
              kind === 'gasto' && styles.kindChipGastoSelected,
            ]}
          >
            Gasto
          </Text>
        </View>

        <TextField
          label="Categoría"
          value={category}
          onChangeText={setCategory}
          autoCapitalize="sentences"
          maxLength={80}
        />
        <View style={styles.suggestionRow}>
          {suggestions.map((s) => (
            <Text
              key={s}
              onPress={() => setCategory(s)}
              style={styles.suggestionChip}
            >
              {s}
            </Text>
          ))}
        </View>

        <TextField
          label="Fecha (AAAA-MM-DD)"
          value={occurredAt}
          onChangeText={setOccurredAt}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
        />

        <TextField
          label="Importe (€)"
          value={amountStr}
          onChangeText={(t) => setAmountStr(sanitizeAmountInput(t))}
          keyboardType="decimal-pad"
        />

        <TextField
          label="Descripción (opcional)"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          maxLength={2000}
          style={styles.descriptionInput}
          textAlignVertical="top"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title="Guardar cambios"
          onPress={handleSave}
          loading={saving}
          disabled={deleting}
          style={styles.saveButton}
        />
        <View style={{ height: theme.spacing.sm }} />
        <Button
          title="Eliminar movimiento"
          variant="ghost"
          onPress={confirmDelete}
          loading={deleting}
          disabled={saving}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingBottom: theme.spacing.xl,
  },
  label: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 13,
    marginBottom: theme.spacing.xs,
  },
  kindRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.md,
  },
  kindChip: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    marginRight: theme.spacing.xs,
    fontSize: 15,
    overflow: 'hidden',
    fontWeight: '600',
  },
  kindChipIngresoSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
    color: theme.colors.primaryText,
  },
  kindChipGastoSelected: {
    borderColor: theme.colors.danger,
    backgroundColor: theme.colors.danger,
    color: theme.colors.primaryText,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: -theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  suggestionChip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.textMuted,
    marginRight: theme.spacing.xs,
    marginTop: theme.spacing.xs,
    fontSize: 12,
    overflow: 'hidden',
  },
  descriptionInput: {
    height: 90,
    paddingTop: theme.spacing.sm,
  },
  error: {
    color: theme.colors.danger,
    marginBottom: theme.spacing.md,
  },
  saveButton: {
    marginTop: theme.spacing.sm,
  },
});
