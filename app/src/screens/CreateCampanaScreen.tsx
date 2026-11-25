import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import { campanasService } from '@/services/campanas.service';
import { theme } from '@/theme';
import { typography } from '@/typography';

type Props = NativeStackScreenProps<MainStackParamList, 'CreateCampana'>;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function CreateCampanaScreen({ route, navigation }: Props): JSX.Element {
  const { fincaId } = route.params;

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validationError(): string | null {
    if (name.trim().length === 0) return 'Pon un nombre a la campaña.';
    if (!ISO_RE.test(startDate)) return 'Fecha de inicio inválida (YYYY-MM-DD).';
    // endDate is optional — a campaign is usually created when it starts.
    // Only validate it when the user actually typed something.
    if (endDate.trim().length > 0) {
      if (!ISO_RE.test(endDate)) return 'Fecha de fin inválida (YYYY-MM-DD).';
      if (endDate < startDate)
        return 'La fecha de fin debe ser igual o posterior al inicio.';
    }
    return null;
  }

  async function onSubmit(): Promise<void> {
    const v = validationError();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const trimmedEnd = endDate.trim();
      const created = await campanasService.create({
        fincaId,
        name: name.trim(),
        startDate,
        ...(trimmedEnd.length > 0 ? { endDate: trimmedEnd } : {}),
      });
      navigation.replace('CampanaDetail', {
        campanaId: created.id,
        campanaName: created.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la campaña');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>Nueva campaña</Text>
      <TextField
        label="Nombre"
        value={name}
        onChangeText={setName}
        placeholder="Ej. Cosecha 2025/26"
        autoFocus
      />
      <TextField
        label="Inicio (YYYY-MM-DD)"
        value={startDate}
        onChangeText={setStartDate}
        placeholder="2025-10-01"
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
      />
      <TextField
        label="Fin (YYYY-MM-DD) — opcional"
        value={endDate}
        onChangeText={setEndDate}
        placeholder="Déjalo vacío si aún no lo sabes"
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
      />
      <Text style={styles.hint}>
        Puedes dejar la fecha de fin vacía y rellenarla cuando termine la
        campaña.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button
          title="Cancelar"
          variant="ghost"
          onPress={() => navigation.goBack()}
          style={styles.flex}
        />
        <View style={{ width: theme.spacing.sm }} />
        <Button
          title="Crear"
          onPress={onSubmit}
          loading={submitting}
          style={styles.flex}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.display,
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    marginTop: theme.spacing.md,
  },
  flex: { flex: 1 },
  hint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: -theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  error: {
    color: theme.colors.danger,
    marginBottom: theme.spacing.md,
  },
});
