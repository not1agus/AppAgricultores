import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import { fincasService } from '@/services/fincas.service';
import { theme } from '@/theme';

type Props = NativeStackScreenProps<MainStackParamList, 'CreateFinca'>;

export function CreateFincaScreen({ navigation }: Props): JSX.Element {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(): Promise<void> {
    if (name.trim().length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await fincasService.create(name.trim());
      navigation.replace('FincaDetail', {
        fincaId: created.id,
        fincaName: created.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la finca');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>Nueva finca</Text>
      <TextField
        label="Nombre"
        value={name}
        onChangeText={setName}
        placeholder="Ej. Olivar Los Encinares"
        autoFocus
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
          title="Crear"
          onPress={onSubmit}
          loading={submitting}
          disabled={name.trim().length === 0}
          style={styles.flex}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
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
