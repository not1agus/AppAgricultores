import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import { OfflineQueuedError } from '@/services/mutationQueue.service';
import {
  TransaccionKind,
  transaccionesService,
} from '@/services/transacciones.service';
import { theme } from '@/theme';

type Props = NativeStackScreenProps<MainStackParamList, 'CreateTransaccion'>;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Quick-fill suggestions per kind. NOT validation — the backend accepts
 * any 1-80 char string. These are speed shortcuts for the most common
 * cases an olivar smallholder records by hand: oil sales, PAC subsidy,
 * supplies. Tapping a chip writes into the free-text input which the
 * user can then edit (e.g. "Venta aceite a granel - cooperativa X").
 */
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

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseEsNumber(raw: string): number | null {
  const trimmed = raw.replace(',', '.').trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Sanitiza la entrada de importe en vivo: deja sólo dígitos y un único
 * separador decimal (acepta indistintamente "," o "."). Esto evita que en
 * web (donde el `keyboardType` no fuerza nada) el usuario pueda meter
 * letras o múltiples separadores. En móvil nativo el `decimal-pad` ya
 * limita el teclado, pero igualmente sanitizamos por si pegan texto. */
function sanitizeAmountInput(raw: string): string {
  // Permite dígitos y un único separador decimal. Quita todo lo demás.
  let cleaned = raw.replace(/[^0-9.,]/g, '');
  // Si hay más de un separador, conserva sólo el primero.
  const firstSepIdx = cleaned.search(/[.,]/);
  if (firstSepIdx !== -1) {
    const before = cleaned.slice(0, firstSepIdx + 1);
    const after = cleaned.slice(firstSepIdx + 1).replace(/[.,]/g, '');
    cleaned = before + after;
  }
  return cleaned;
}

export function CreateTransaccionScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const { campanaId } = route.params;

  const [kind, setKind] = useState<TransaccionKind>('gasto');
  const [category, setCategory] = useState('');
  const [occurredAt, setOccurredAt] = useState(todayIso());
  const [amountStr, setAmountStr] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (saving) return;
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
      await transaccionesService.create({
        campanaId,
        kind,
        category: category.trim(),
        occurredAt,
        amountEur: amount,
        ...(trimmedDesc.length > 0 ? { description: trimmedDesc } : {}),
      });
      navigation.goBack();
    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        Alert.alert(
          'Guardado para sincronizar',
          'Sin conexión. La transacción se enviará cuando vuelva internet.',
          [{ text: 'Aceptar', onPress: () => navigation.goBack() }],
        );
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo guardar.');
      }
    } finally {
      setSaving(false);
    }
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
                // Categorías de ingreso y gasto son listas distintas — una
                // categoría de gasto (p.ej. "Almazara") no tiene sentido
                // si se contabiliza como ingreso: el importe acabaría
                // restando del balance correcto. Limpiamos al togglear
                // para forzar al usuario a re-elegir.
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
          placeholder="Ej. Venta aceite, Almazara, Fertilizante…"
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
          placeholder="0,00"
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
          title="Guardar"
          onPress={handleSave}
          loading={saving}
          style={styles.saveButton}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: theme.spacing.xl,
  },
  label: {
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
