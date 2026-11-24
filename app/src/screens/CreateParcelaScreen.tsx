import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import { parcelasService } from '@/services/parcelas.service';
import {
  SigpacParcelResult,
  SigpacReference,
  sigpacService,
} from '@/services/sigpac.service';
import { theme } from '@/theme';

type Props = NativeStackScreenProps<MainStackParamList, 'CreateParcela'>;
type Mode = 'sigpac' | 'manual';

const DIGITS_RE = /^\d+$/;

interface SigpacForm {
  provincia: string;
  municipio: string;
  poligono: string;
  parcela: string;
  recinto: string;
}

const EMPTY_SIGPAC: SigpacForm = {
  provincia: '',
  municipio: '',
  poligono: '',
  parcela: '',
  recinto: '',
};

function buildReference(form: SigpacForm): SigpacReference | string {
  // Returns either a valid reference or an error string for the user.
  const required: Array<[keyof SigpacForm, string, number]> = [
    ['provincia', 'Provincia', 2],
    ['municipio', 'Municipio', 3],
    ['poligono', 'Polígono', 5],
    ['parcela', 'Parcela', 5],
  ];
  for (const [key, label, max] of required) {
    const v = form[key].trim();
    if (v.length === 0) return `Falta ${label}.`;
    if (!DIGITS_RE.test(v)) return `${label} sólo admite dígitos.`;
    if (v.length > max) return `${label} máximo ${max} dígitos.`;
  }
  const recinto = form.recinto.trim();
  if (recinto.length > 0) {
    if (!DIGITS_RE.test(recinto)) return 'Recinto sólo admite dígitos.';
    if (recinto.length > 5) return 'Recinto máximo 5 dígitos.';
  }
  const ref: SigpacReference = {
    provincia: form.provincia.trim(),
    municipio: form.municipio.trim(),
    poligono: form.poligono.trim(),
    parcela: form.parcela.trim(),
  };
  if (recinto.length > 0) ref.recinto = recinto;
  return ref;
}

function parseEsNumber(raw: string): number | null {
  const trimmed = raw.replace(',', '.').trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function refLabel(ref: SigpacReference): string {
  const tail = ref.recinto ? `:${ref.recinto}` : '';
  return `${ref.provincia}:${ref.municipio}:${ref.poligono}:${ref.parcela}${tail}`;
}

export function CreateParcelaScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const { fincaId } = route.params;

  const [mode, setMode] = useState<Mode>('sigpac');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // SIGPAC mode state
  const [sigpacForm, setSigpacForm] = useState<SigpacForm>(EMPTY_SIGPAC);
  const [lookingUp, setLookingUp] = useState(false);
  const [sigpacResult, setSigpacResult] = useState<SigpacParcelResult | null>(
    null,
  );

  // Manual mode state
  const [manualAreaHa, setManualAreaHa] = useState('');

  const [submitting, setSubmitting] = useState(false);

  function setSigpacField(key: keyof SigpacForm, v: string): void {
    setSigpacForm((prev) => ({ ...prev, [key]: v }));
    setSigpacResult(null);
    setError(null);
  }

  async function onLookup(): Promise<void> {
    const refOrErr = buildReference(sigpacForm);
    if (typeof refOrErr === 'string') {
      setError(refOrErr);
      return;
    }
    setLookingUp(true);
    setError(null);
    try {
      const result = await sigpacService.lookup(refOrErr);
      setSigpacResult(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo consultar SIGPAC. Revisa la referencia.',
      );
    } finally {
      setLookingUp(false);
    }
  }

  async function onSubmit(): Promise<void> {
    if (name.trim().length === 0) {
      setError('Pon un nombre a la parcela.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let created;
      if (mode === 'sigpac') {
        const refOrErr = buildReference(sigpacForm);
        if (typeof refOrErr === 'string') {
          setError(refOrErr);
          setSubmitting(false);
          return;
        }
        // Backend's POST /parcelas/from-sigpac re-resolves the reference and
        // persists area + geometry server-side, so we don't have to send the
        // lookup result back. Cleaner and one less surface for tampering.
        created = await parcelasService.createFromSigpac({
          fincaId,
          name: name.trim(),
          reference: refOrErr,
        });
      } else {
        const area = manualAreaHa.trim().length > 0
          ? parseEsNumber(manualAreaHa)
          : null;
        if (manualAreaHa.trim().length > 0 && (area === null || area <= 0)) {
          setError('Superficie inválida.');
          setSubmitting(false);
          return;
        }
        created = await parcelasService.create({
          fincaId,
          name: name.trim(),
          ...(area !== null ? { areaHa: area } : {}),
        });
      }
      // Pop back to the parcelas list (which reloads on focus).
      navigation.goBack();
      // Hint for telemetry/debug — Expo strips console.log in prod builds
      // unless configured otherwise.
      console.log('Parcela creada', created.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo crear la parcela',
      );
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nueva parcela</Text>

        <View style={styles.modeRow}>
          <Text
            onPress={() => {
              setMode('sigpac');
              setError(null);
            }}
            style={[styles.modeChip, mode === 'sigpac' && styles.modeChipActive]}
          >
            Desde SIGPAC
          </Text>
          <Text
            onPress={() => {
              setMode('manual');
              setError(null);
            }}
            style={[styles.modeChip, mode === 'manual' && styles.modeChipActive]}
          >
            Manual
          </Text>
        </View>

        <TextField
          label="Nombre"
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError(null);
          }}
          placeholder="Ej. Olivar de la Loma"
          autoFocus
        />

        {mode === 'sigpac' ? (
          <>
            <Text style={styles.sectionTitle}>Referencia SIGPAC</Text>
            <Text style={styles.help}>
              Introduce los códigos sin ceros sobrantes. Recinto es opcional;
              si lo omites se usa el conjunto de la parcela.
            </Text>

            <View style={styles.refRow}>
              <View style={styles.refCellSmall}>
                <TextField
                  label="Prov."
                  value={sigpacForm.provincia}
                  onChangeText={(v) => setSigpacField('provincia', v)}
                  keyboardType="number-pad"
                  maxLength={2}
                />
              </View>
              <View style={styles.refCell}>
                <TextField
                  label="Municipio"
                  value={sigpacForm.municipio}
                  onChangeText={(v) => setSigpacField('municipio', v)}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>
            </View>

            <View style={styles.refRow}>
              <View style={styles.refCell}>
                <TextField
                  label="Polígono"
                  value={sigpacForm.poligono}
                  onChangeText={(v) => setSigpacField('poligono', v)}
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
              <View style={styles.refCell}>
                <TextField
                  label="Parcela"
                  value={sigpacForm.parcela}
                  onChangeText={(v) => setSigpacField('parcela', v)}
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
              <View style={styles.refCell}>
                <TextField
                  label="Recinto"
                  value={sigpacForm.recinto}
                  onChangeText={(v) => setSigpacField('recinto', v)}
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
            </View>

            <Button
              title="Consultar SIGPAC"
              variant="ghost"
              onPress={onLookup}
              loading={lookingUp}
              disabled={lookingUp}
            />

            {sigpacResult ? (
              <Card style={styles.previewCard}>
                <Text style={styles.previewTitle}>Parcela encontrada</Text>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Referencia</Text>
                  <Text style={styles.previewValue}>
                    {refLabel(sigpacResult.reference)}
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Superficie</Text>
                  <Text style={styles.previewValue}>
                    {sigpacResult.areaHa !== null
                      ? `${sigpacResult.areaHa.toFixed(2)} ha`
                      : '—'}
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Geometría</Text>
                  <Text style={styles.previewValue}>
                    {sigpacResult.geometry.type}
                  </Text>
                </View>
              </Card>
            ) : (
              <Text style={styles.help}>
                {lookingUp
                  ? null
                  : 'Pulsa «Consultar SIGPAC» para previsualizar la parcela antes de guardarla.'}
              </Text>
            )}
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Datos manuales</Text>
            <Text style={styles.help}>
              Si no tienes la referencia SIGPAC, registra la parcela sólo con
              el nombre y, opcionalmente, la superficie estimada.
            </Text>
            <TextField
              label="Superficie (ha) — opcional"
              value={manualAreaHa}
              onChangeText={setManualAreaHa}
              keyboardType="decimal-pad"
              placeholder="Ej. 4,2"
            />
          </>
        )}

        {lookingUp && mode === 'sigpac' ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : null}

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
            disabled={submitting}
            style={styles.flex}
          />
        </View>
      </ScrollView>
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
  modeRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.lg,
  },
  modeChip: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    fontWeight: '600',
    overflow: 'hidden',
  },
  modeChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    color: theme.colors.primaryText,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  help: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginBottom: theme.spacing.md,
  },
  refRow: {
    flexDirection: 'row',
  },
  refCell: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  refCellSmall: {
    width: 84,
    marginRight: theme.spacing.sm,
  },
  previewCard: {
    marginTop: theme.spacing.md,
  },
  previewTitle: {
    fontWeight: '700',
    color: theme.colors.text,
    fontSize: 15,
    marginBottom: theme.spacing.sm,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.xs,
  },
  previewLabel: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  previewValue: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  center: {
    alignItems: 'center',
    marginVertical: theme.spacing.md,
  },
  actions: {
    flexDirection: 'row',
    marginTop: theme.spacing.lg,
  },
  flex: { flex: 1 },
  error: {
    color: theme.colors.danger,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
});
