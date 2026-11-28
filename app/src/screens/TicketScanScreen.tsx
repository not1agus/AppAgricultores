import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import type { MainStackParamList } from '@/navigation/types';
import { uploadTicketImage } from '@/services/storage.service';
import { ticketsService } from '@/services/tickets.service';
import type { TransaccionKind } from '@/services/transacciones.service';
import { theme } from '@/theme';
import { typography } from '@/typography';

type Props = NativeStackScreenProps<MainStackParamList, 'TicketScan'>;

async function pickFromCamera(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Permiso de cámara denegado');
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.85,
    // Ticket photos benefit from light compression only; leave no crop.
  });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

async function pickFromLibrary(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Permiso de galería denegado');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.85,
  });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

export function TicketScanScreen({ route, navigation }: Props): JSX.Element {
  const { fincaId } = route.params;
  // The user picks gasto/ingreso first; the rest of the screen stays hidden
  // until then. The ticket carries this kind so a later "promover a
  // movimiento" knows which side of the books it belongs to.
  const [kind, setKind] = useState<TransaccionKind | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePick(source: 'camera' | 'library'): Promise<void> {
    setError(null);
    try {
      const uri =
        source === 'camera' ? await pickFromCamera() : await pickFromLibrary();
      if (uri) setLocalUri(uri);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo seleccionar la imagen');
    }
  }

  async function handleUpload(): Promise<void> {
    if (!localUri || busy || !kind) return;
    setBusy(true);
    setError(null);
    try {
      setStage('Subiendo imagen…');
      const imageUrl = await uploadTicketImage(localUri);
      setStage('Procesando OCR…');
      const ticket = await ticketsService.create({ fincaId, imageUrl, kind });
      navigation.replace('TicketDetail', { ticketId: ticket.id, fincaId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando el ticket');
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  // Step 1: choose gasto / ingreso before anything else.
  if (kind === null) {
    return (
      <Screen>
        <Text style={styles.title}>Escanear ticket</Text>
        <Text style={styles.subtitle}>
          ¿Este ticket es un gasto o un ingreso?
        </Text>
        <Button
          title="Gasto (pago a la almazara, suministros…)"
          onPress={() => setKind('gasto')}
          style={styles.kindButton}
        />
        <Button
          title="Ingreso (venta de aceite, liquidación…)"
          onPress={() => setKind('ingreso')}
          variant="ghost"
          style={styles.kindButton}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Escanear ticket</Text>
        <Text
          style={[
            styles.kindBadge,
            kind === 'gasto' ? styles.kindBadgeGasto : styles.kindBadgeIngreso,
          ]}
          onPress={() => {
            // Let the user go back to the gasto/ingreso choice.
            setKind(null);
            setLocalUri(null);
          }}
        >
          {kind === 'gasto' ? 'Gasto' : 'Ingreso'} · cambiar
        </Text>
      </View>
      <Text style={styles.subtitle}>
        Captura o selecciona una foto del ticket de almazara. El OCR corre en
        el servidor; podrás corregir los datos antes de confirmar.
      </Text>

      {localUri ? (
        <Image source={{ uri: localUri }} style={styles.preview} />
      ) : (
        <View style={styles.previewPlaceholder}>
          <Text style={styles.placeholderText}>Sin imagen seleccionada</Text>
        </View>
      )}

      <View style={styles.pickRow}>
        <Button
          title="Cámara"
          onPress={() => void handlePick('camera')}
          variant="ghost"
          disabled={busy}
          style={styles.flex}
        />
        <View style={{ width: theme.spacing.sm }} />
        <Button
          title="Galería"
          onPress={() => void handlePick('library')}
          variant="ghost"
          disabled={busy}
          style={styles.flex}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {stage ? <Text style={styles.stage}>{stage}</Text> : null}

      <Button
        title="Subir y procesar"
        onPress={handleUpload}
        loading={busy}
        disabled={!localUri}
        style={styles.submit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.display,
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kindButton: {
    marginTop: theme.spacing.md,
  },
  kindBadge: {
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    color: theme.colors.primaryText,
  },
  kindBadgeGasto: {
    backgroundColor: theme.colors.danger,
  },
  kindBadgeIngreso: {
    backgroundColor: theme.colors.primary,
  },
  subtitle: {
    ...typography.body,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  preview: {
    width: '100%',
    height: 260,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
    resizeMode: 'cover',
  },
  previewPlaceholder: {
    width: '100%',
    height: 260,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  placeholderText: { color: theme.colors.textMuted },
  pickRow: { flexDirection: 'row' },
  flex: { flex: 1 },
  submit: { marginTop: theme.spacing.md },
  error: {
    color: theme.colors.danger,
    marginTop: theme.spacing.sm,
  },
  stage: {
    color: theme.colors.textMuted,
    marginTop: theme.spacing.sm,
  },
});
