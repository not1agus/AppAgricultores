import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import { parcelasService } from '@/services/parcelas.service';
import { theme } from '@/theme';

type Props = NativeStackScreenProps<MainStackParamList, 'EditParcela'>;

function parseEsNumber(raw: string): number | null {
  const trimmed = raw.replace(',', '.').trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function EditParcelaScreen({ route, navigation }: Props): JSX.Element {
  const { parcelaId } = route.params;

  const [name, setName] = useState('');
  const [areaHa, setAreaHa] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    parcelasService
      .getById(parcelaId)
      .then((p) => {
        if (cancelled) return;
        setName(p.name);
        setAreaHa(p.areaHa !== null ? String(p.areaHa) : '');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Error cargando parcela');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [parcelaId]);

  function validationError(): string | null {
    if (name.trim().length === 0) return 'Pon un nombre a la parcela.';
    if (areaHa.trim().length > 0) {
      const n = parseEsNumber(areaHa);
      if (n === null || n <= 0) return 'Superficie inválida (hectáreas > 0).';
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
      // Empty areaHa explicitly clears it (PATCH accepts null).
      const area = areaHa.trim().length > 0 ? parseEsNumber(areaHa) : null;
      await parcelasService.update(parcelaId, {
        name: name.trim(),
        areaHa: area,
      });
      navigation.goBack();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo actualizar la parcela',
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
      <Text style={styles.title}>Editar parcela</Text>
      <Text style={styles.note}>
        La referencia SIGPAC y la geometría no se editan desde aquí — si
        necesitas cambiarlas, elimina la parcela y créala de nuevo.
      </Text>

      <TextField
        label="Nombre"
        value={name}
        onChangeText={setName}
        placeholder="Ej. Olivar norte"
      />
      <TextField
        label="Superficie (ha) — opcional"
        value={areaHa}
        onChangeText={setAreaHa}
        placeholder="Ej. 3,25"
        keyboardType="decimal-pad"
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
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  note: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: theme.spacing.md,
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
