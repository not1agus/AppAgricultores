import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
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
import {
  EMPTY_FITOSANITARIO_DRAFT,
  FitosanitarioDraft,
  FitosanitarioFields,
  fitosanitarioToDraft,
  parseFitosanitarioDraft,
} from '@/components/FitosanitarioFields';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import {
  ACTIVIDAD_TYPE_LABELS,
  ACTIVIDAD_TYPES,
  Actividad,
  ActividadType,
  actividadesService,
} from '@/services/actividades.service';
import { Campana, campanasService } from '@/services/campanas.service';
import { OfflineQueuedError } from '@/services/mutationQueue.service';
import { parcelasService } from '@/services/parcelas.service';
import { uploadActividadImage } from '@/services/storage.service';
import { theme } from '@/theme';

type Props = NativeStackScreenProps<MainStackParamList, 'EditActividad'>;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PHOTOS = 10;

async function pickFromCamera(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Permiso de cámara denegado');
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.85,
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

function parseEsNumber(raw: string): number | null {
  const trimmed = raw.replace(',', '.').trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function EditActividadScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const { actividadId } = route.params;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Type/date/description/cost are the only mutable scalar fields — parcelaId
  // is intentionally immutable (moving an actividad between parcelas would
  // fracture the cuaderno audit trail; delete + recreate is the safe path).
  const [type, setType] = useState<ActividadType>('tratamiento_fitosanitario');
  const [performedAt, setPerformedAt] = useState('');
  const [description, setDescription] = useState('');
  const [costEur, setCostEur] = useState('');

  // Photo state split: already-uploaded Storage URLs the user can drop, plus
  // newly-picked local URIs that still need uploading on save.
  const [remoteUrls, setRemoteUrls] = useState<string[]>([]);
  const [newLocalUris, setNewLocalUris] = useState<string[]>([]);

  // Fitosanitario draft + a flag tracking whether the loaded actividad came
  // with one. We need that flag separately because if the user changes the
  // type away from tratamiento_fitosanitario we have to explicitly send
  // `fitosanitario: null` to clear the stored block — otherwise the DB CHECK
  // constraint would reject the update.
  const [fitoDraft, setFitoDraft] = useState<FitosanitarioDraft>(
    EMPTY_FITOSANITARIO_DRAFT,
  );
  const [originalHadFito, setOriginalHadFito] = useState(false);

  // Optional campaña tag. campanaId === null means "not tagged".
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [campanaId, setCampanaId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    actividadesService
      .getById(actividadId)
      .then((a: Actividad) => {
        if (cancelled) return;
        setType(a.type);
        setPerformedAt(a.performedAt);
        setDescription(a.description ?? '');
        setCostEur(a.costEur !== null ? String(a.costEur) : '');
        setRemoteUrls(a.photos);
        setCampanaId(a.campanaId);
        if (a.fitosanitario) {
          setFitoDraft(fitosanitarioToDraft(a.fitosanitario));
          setOriginalHadFito(true);
        }
        // Resolve the finca via the parcela, then load that finca's
        // campañas to populate the optional picker. Failure is silent —
        // the tag is optional.
        void parcelasService
          .getById(a.parcelaId)
          .then((p) => campanasService.listByFinca(p.fincaId))
          .then((list) => {
            if (!cancelled) setCampanas(list);
          })
          .catch(() => {
            /* silent: campaña tag is optional */
          });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'Error cargando actividad',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actividadId]);

  const totalPhotos = remoteUrls.length + newLocalUris.length;

  async function handlePick(source: 'camera' | 'library'): Promise<void> {
    if (totalPhotos >= MAX_PHOTOS) {
      setError(`Máximo ${MAX_PHOTOS} fotos por actividad.`);
      return;
    }
    setError(null);
    try {
      const uri =
        source === 'camera' ? await pickFromCamera() : await pickFromLibrary();
      if (uri) setNewLocalUris((prev) => [...prev, uri]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo seleccionar la imagen',
      );
    }
  }

  function removeRemote(index: number): void {
    setRemoteUrls((prev) => prev.filter((_, i) => i !== index));
  }

  function removeLocal(index: number): void {
    setNewLocalUris((prev) => prev.filter((_, i) => i !== index));
  }

  function validationError(): string | null {
    if (!ISO_RE.test(performedAt)) return 'Fecha inválida (YYYY-MM-DD).';
    if (costEur.trim().length > 0) {
      const n = parseEsNumber(costEur);
      if (n === null || n < 0) return 'Coste inválido.';
    }
    return null;
  }

  async function onSubmit(): Promise<void> {
    const v = validationError();
    if (v) {
      setError(v);
      return;
    }

    // Decide what to send for the fitosanitario field:
    //   * type stays/becomes tratamiento_fitosanitario → parse the draft
    //     (and surface validation errors before doing photo uploads)
    //   * type changed away from it AND the row originally had a block →
    //     send `null` to clear the stored compliance data
    //   * otherwise leave it `undefined` (unchanged)
    let fitosanitarioPayload: ReturnType<typeof parseFitosanitarioDraft>['value']
      | null
      | undefined;
    if (type === 'tratamiento_fitosanitario') {
      const parsed = parseFitosanitarioDraft(fitoDraft);
      if (parsed.error) {
        setError(parsed.error);
        return;
      }
      fitosanitarioPayload = parsed.value;
    } else if (originalHadFito) {
      fitosanitarioPayload = null;
    }

    setSubmitting(true);
    setError(null);
    try {
      const trimmedDesc = description.trim();
      const cost = costEur.trim().length > 0 ? parseEsNumber(costEur) : null;

      const uploadedNew: string[] = [];
      for (let i = 0; i < newLocalUris.length; i++) {
        setUploadStage(`Subiendo foto ${i + 1}/${newLocalUris.length}…`);
        const url = await uploadActividadImage(newLocalUris[i]!);
        uploadedNew.push(url);
      }
      setUploadStage(null);

      // description/costEur use null to clear a previously-set value (backend
      // PATCH accepts null explicitly for both).
      await actividadesService.update(actividadId, {
        type,
        performedAt,
        description: trimmedDesc.length > 0 ? trimmedDesc : null,
        costEur: cost,
        photos: [...remoteUrls, ...uploadedNew],
        ...(fitosanitarioPayload !== undefined
          ? { fitosanitario: fitosanitarioPayload }
          : {}),
        // Always send campanaId: null explicitly unlinks, a string links.
        campanaId,
      });
      navigation.goBack();
    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        // The PATCH was queued. The detail screen will still show stale
        // data on focus, but the badge there will (eventually) reflect
        // the pending sync. Acceptable v1 tradeoff vs building optimistic
        // local state for every screen.
        Alert.alert(
          'Guardado para sincronizar',
          'Sin conexión. Los cambios se enviarán automáticamente cuando vuelva internet.',
          [{ text: 'Aceptar', onPress: () => navigation.goBack() }],
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudo actualizar la actividad',
        );
      }
    } finally {
      setSubmitting(false);
      setUploadStage(null);
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
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Editar actividad</Text>

        <Text style={styles.label}>Tipo</Text>
        <View style={styles.chipsWrap}>
          {ACTIVIDAD_TYPES.map((t) => {
            const selected = t === type;
            return (
              <Text
                key={t}
                onPress={() => setType(t)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                {ACTIVIDAD_TYPE_LABELS[t]}
              </Text>
            );
          })}
        </View>

        {campanas.length > 0 ? (
          <>
            <Text style={styles.label}>Campaña — opcional</Text>
            <View style={styles.chipsWrap}>
              <Text
                onPress={() => setCampanaId(null)}
                style={[
                  styles.chip,
                  campanaId === null && styles.chipSelected,
                ]}
              >
                Ninguna
              </Text>
              {campanas.map((c) => {
                const selected = c.id === campanaId;
                return (
                  <Text
                    key={c.id}
                    onPress={() => setCampanaId(c.id)}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    {c.name}
                  </Text>
                );
              })}
            </View>
          </>
        ) : null}

        <TextField
          label="Fecha (YYYY-MM-DD)"
          value={performedAt}
          onChangeText={setPerformedAt}
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
        />
        <TextField
          label="Coste (€) — opcional"
          value={costEur}
          onChangeText={setCostEur}
          keyboardType="decimal-pad"
          placeholder="Ej. 120,50"
        />
        <TextField
          label="Notas — opcional"
          value={description}
          onChangeText={setDescription}
          placeholder="Observaciones de campo…"
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          style={styles.notes}
        />

        {type === 'tratamiento_fitosanitario' ? (
          <FitosanitarioFields
            value={fitoDraft}
            onChange={setFitoDraft}
            disabled={submitting}
          />
        ) : null}

        <Text style={styles.label}>
          Fotos ({totalPhotos}/{MAX_PHOTOS})
        </Text>
        {totalPhotos > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.thumbRow}
          >
            {remoteUrls.map((uri, idx) => (
              <View key={`r-${uri}`} style={styles.thumbWrap}>
                <Image source={{ uri }} style={styles.thumb} />
                <Pressable
                  onPress={() => removeRemote(idx)}
                  style={styles.thumbRemove}
                  hitSlop={8}
                  disabled={submitting}
                >
                  <Text style={styles.thumbRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
            {newLocalUris.map((uri, idx) => (
              <View key={`l-${uri}-${idx}`} style={styles.thumbWrap}>
                <Image source={{ uri }} style={styles.thumb} />
                <View style={styles.newBadge}>
                  <Text style={styles.newBadgeText}>NUEVA</Text>
                </View>
                <Pressable
                  onPress={() => removeLocal(idx)}
                  style={styles.thumbRemove}
                  hitSlop={8}
                  disabled={submitting}
                >
                  <Text style={styles.thumbRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.pickRow}>
          <Button
            title="Cámara"
            variant="ghost"
            onPress={() => void handlePick('camera')}
            disabled={submitting || totalPhotos >= MAX_PHOTOS}
            style={styles.flex}
          />
          <View style={{ width: theme.spacing.sm }} />
          <Button
            title="Galería"
            variant="ghost"
            onPress={() => void handlePick('library')}
            disabled={submitting || totalPhotos >= MAX_PHOTOS}
            style={styles.flex}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {uploadStage ? <Text style={styles.stage}>{uploadStage}</Text> : null}

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
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.lg,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: theme.spacing.xs,
    marginTop: theme.spacing.sm,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    marginRight: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
    fontSize: 13,
    overflow: 'hidden',
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    color: theme.colors.primaryText,
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
  notes: {
    height: 110,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  thumbRow: {
    marginBottom: theme.spacing.sm,
  },
  thumbWrap: {
    marginRight: theme.spacing.sm,
    position: 'relative',
  },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  newBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },
  newBadgeText: {
    color: theme.colors.primaryText,
    fontSize: 9,
    fontWeight: '700',
  },
  pickRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.sm,
  },
  stage: {
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
  },
});
