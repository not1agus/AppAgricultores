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
  parseFitosanitarioDraft,
} from '@/components/FitosanitarioFields';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import {
  ACTIVIDAD_TYPE_LABELS,
  ACTIVIDAD_TYPES,
  ActividadType,
  actividadesService,
} from '@/services/actividades.service';
import { Campana, campanasService } from '@/services/campanas.service';
import { OfflineQueuedError } from '@/services/mutationQueue.service';
import { Parcela, parcelasService } from '@/services/parcelas.service';
import { scheduleDeadlineNotification } from '@/services/notifications.service';
import { uploadActividadImage } from '@/services/storage.service';
import { theme } from '@/theme';

type Props = NativeStackScreenProps<MainStackParamList, 'CreateActividad'>;

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

export function CreateActividadScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const { fincaId, parcelaId: preselectedParcelaId } = route.params;

  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [parcelaId, setParcelaId] = useState<string | null>(null);
  // Campaña tag is optional — null means "not tagged to any campaign".
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [campanaId, setCampanaId] = useState<string | null>(null);
  const [type, setType] = useState<ActividadType>('tratamiento_fitosanitario');
  const [performedAt, setPerformedAt] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [costEur, setCostEur] = useState('');
  const [localPhotos, setLocalPhotos] = useState<string[]>([]);
  const [loadingParcelas, setLoadingParcelas] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The fitosanitario draft is preserved while the user toggles `type` so they
  // don't lose typed data if they accidentally tap a different chip and come
  // back. It's only submitted when type === 'tratamiento_fitosanitario'.
  const [fitoDraft, setFitoDraft] = useState<FitosanitarioDraft>(
    EMPTY_FITOSANITARIO_DRAFT,
  );

  useEffect(() => {
    let cancelled = false;
    void parcelasService
      .listByFinca(fincaId)
      .then((list) => {
        if (cancelled) return;
        setParcelas(list);
        // Honour the preselection from ParcelaDetail if it still exists in
        // the finca; otherwise fall back to the first one. The defensive
        // `find` guards against a stale param where the parcela was deleted
        // between navigations — in that case we just default rather than
        // silently leave nothing selected.
        const preselected =
          preselectedParcelaId &&
          list.some((p) => p.id === preselectedParcelaId)
            ? preselectedParcelaId
            : (list[0]?.id ?? null);
        setParcelaId(preselected);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'Error cargando parcelas',
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingParcelas(false);
      });
    // Campañas load independently — failure here just leaves the optional
    // campaña picker empty, it must not block the screen.
    void campanasService
      .listByFinca(fincaId)
      .then((list) => {
        if (!cancelled) setCampanas(list);
      })
      .catch(() => {
        /* silent: campaña tag is optional */
      });
    return () => {
      cancelled = true;
    };
  }, [fincaId, preselectedParcelaId]);

  async function handlePick(source: 'camera' | 'library'): Promise<void> {
    if (localPhotos.length >= MAX_PHOTOS) {
      setError(`Máximo ${MAX_PHOTOS} fotos por actividad.`);
      return;
    }
    setError(null);
    try {
      const uri =
        source === 'camera' ? await pickFromCamera() : await pickFromLibrary();
      if (uri) setLocalPhotos((prev) => [...prev, uri]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo seleccionar la imagen',
      );
    }
  }

  function removePhoto(index: number): void {
    setLocalPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  function validationError(): string | null {
    if (!parcelaId) return 'Selecciona una parcela.';
    if (!ISO_RE.test(performedAt))
      return 'Fecha inválida (YYYY-MM-DD).';
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
    if (!parcelaId) return;

    // Validate fitosanitario before any expensive work (uploads). Skip the
    // check entirely when the type isn't a phytosanitary treatment — the
    // draft state is just dormant in that case.
    let fitosanitarioPayload: ReturnType<
      typeof parseFitosanitarioDraft
    >['value'] = undefined;
    if (type === 'tratamiento_fitosanitario') {
      const parsed = parseFitosanitarioDraft(fitoDraft);
      if (parsed.error) {
        setError(parsed.error);
        return;
      }
      fitosanitarioPayload = parsed.value;
    }

    setSubmitting(true);
    setError(null);
    try {
      const trimmedDesc = description.trim();
      const cost = costEur.trim().length > 0 ? parseEsNumber(costEur) : null;

      // Upload photos sequentially so progress can be reported and a failure
      // on photo N doesn't leave orphan uploads from 1..N-1 without context.
      const uploaded: string[] = [];
      for (let i = 0; i < localPhotos.length; i++) {
        setUploadStage(`Subiendo foto ${i + 1}/${localPhotos.length}…`);
        const url = await uploadActividadImage(localPhotos[i]!);
        uploaded.push(url);
      }
      setUploadStage(null);

      const created = await actividadesService.create({
        parcelaId,
        type,
        performedAt,
        ...(trimmedDesc.length > 0 ? { description: trimmedDesc } : {}),
        ...(cost !== null ? { costEur: cost } : {}),
        ...(uploaded.length > 0 ? { photos: uploaded } : {}),
        ...(fitosanitarioPayload ? { fitosanitario: fitosanitarioPayload } : {}),
        ...(campanaId ? { campanaId } : {}),
      });
      if (type === 'tratamiento_fitosanitario' && fitosanitarioPayload) {
        const parcelaName = parcelas.find((p) => p.id === parcelaId)?.name ?? '';
        void scheduleDeadlineNotification(
          created.id,
          fitosanitarioPayload.productoComercial,
          parcelaName,
          fitosanitarioPayload.plazoSeguridadDias,
          performedAt,
        );
      }
      navigation.replace('ActividadDetail', {
        actividadId: created.id,
        fincaId,
      });
    } catch (err) {
      // Offline path: the create request was persisted to the queue and
      // will replay when the network's back. We can't navigate to the
      // detail screen because the actividad doesn't exist server-side
      // yet — just confirm and go back to the list, where the offline
      // badge surfaces the pending count.
      if (err instanceof OfflineQueuedError) {
        Alert.alert(
          'Guardado para sincronizar',
          'Sin conexión. La actividad se enviará automáticamente cuando vuelva internet. Las fotos ya subidas se mantienen.',
          [{ text: 'Aceptar', onPress: () => navigation.goBack() }],
        );
      } else {
        setError(
          err instanceof Error ? err.message : 'No se pudo crear la actividad',
        );
      }
    } finally {
      setSubmitting(false);
      setUploadStage(null);
    }
  }

  if (loadingParcelas) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  if (parcelas.length === 0) {
    return (
      <Screen>
        <Text style={styles.title}>Nueva actividad</Text>
        <Text style={styles.empty}>
          Esta finca no tiene parcelas. Añade una parcela antes de registrar
          actividades.
        </Text>
        <Button
          title="Volver"
          variant="ghost"
          onPress={() => navigation.goBack()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nueva actividad</Text>

        <Text style={styles.label}>Parcela</Text>
        <View style={styles.chipsWrap}>
          {parcelas.map((p) => {
            const selected = p.id === parcelaId;
            return (
              <Text
                key={p.id}
                onPress={() => setParcelaId(p.id)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                {p.name}
              </Text>
            );
          })}
        </View>

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

        {/* Campaña — optional tag. Lets the grower know later "in which
            harvest season was this done" without re-registering anything.
            We only show the picker when the finca actually has campañas. */}
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
          Fotos — opcional ({localPhotos.length}/{MAX_PHOTOS})
        </Text>
        {localPhotos.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.thumbRow}
          >
            {localPhotos.map((uri, idx) => (
              <View key={`${uri}-${idx}`} style={styles.thumbWrap}>
                <Image source={{ uri }} style={styles.thumb} />
                <Pressable
                  onPress={() => removePhoto(idx)}
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
            disabled={submitting || localPhotos.length >= MAX_PHOTOS}
            style={styles.flex}
          />
          <View style={{ width: theme.spacing.sm }} />
          <Button
            title="Galería"
            variant="ghost"
            onPress={() => void handlePick('library')}
            disabled={submitting || localPhotos.length >= MAX_PHOTOS}
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
            title="Crear"
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
  empty: {
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.lg,
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
  pickRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.sm,
  },
  stage: {
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
  },
});
