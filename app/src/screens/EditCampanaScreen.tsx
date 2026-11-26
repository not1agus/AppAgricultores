import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import { campanasService } from '@/services/campanas.service';
import { scheduleCampanaNotifications } from '@/services/notifications.service';
import { theme } from '@/theme';
import { typography } from '@/typography';

type Props = NativeStackScreenProps<MainStackParamList, 'EditCampana'>;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function EditCampanaScreen({ route, navigation }: Props): JSX.Element {
  const { campanaId } = route.params;

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    campanasService
      .getById(campanaId)
      .then((c) => {
        if (cancelled) return;
        setName(c.name);
        setStartDate(c.startDate);
        // endDate may be null for an open-ended campaign.
        setEndDate(c.endDate ?? '');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Error cargando campaña');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campanaId]);

  function validationError(): string | null {
    if (name.trim().length === 0) return 'Pon un nombre a la campaña.';
    if (!ISO_RE.test(startDate)) return 'Fecha de inicio inválida (YYYY-MM-DD).';
    // endDate optional: an empty field means the campaign stays open.
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
      await campanasService.update(campanaId, {
        name: name.trim(),
        startDate,
        // Empty field -> null clears the end date (reopens the campaign).
        endDate: trimmedEnd.length > 0 ? trimmedEnd : null,
      });
      void scheduleCampanaNotifications(
        campanaId,
        name.trim(),
        startDate,
        trimmedEnd.length > 0 ? trimmedEnd : null,
      );
      navigation.goBack();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo actualizar la campaña',
      );
    } finally {
      setSubmitting(false);
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

  return (
    <Screen>
      <Text style={styles.title}>Editar campaña</Text>
      <TextField
        label="Nombre"
        value={name}
        onChangeText={setName}
        placeholder="Ej. Cosecha 2025/26"
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
        placeholder="Vacío = campaña en curso"
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
      />

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
          title="Guardar"
          onPress={onSubmit}
          loading={submitting}
          style={styles.flex}
        />
      </View>
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
    marginBottom: theme.spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    marginTop: theme.spacing.md,
  },
  flex: { flex: 1 },
  error: {
    color: theme.colors.danger,
    marginBottom: theme.spacing.md,
  },
});
