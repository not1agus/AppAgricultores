import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import { GeoJsonPolygon, parcelasService } from '@/services/parcelas.service';
import {
  buildSigpacReference,
  SigpacForm,
  SigpacReference,
  sigpacService,
} from '@/services/sigpac.service';
import { theme } from '@/theme';
import { typography } from '@/typography';

type Props = NativeStackScreenProps<MainStackParamList, 'EditParcela'>;

const SIGPAC_FIELDS: Array<[keyof SigpacForm, string]> = [
  ['provincia', 'Provincia'],
  ['municipio', 'Municipio'],
  ['agregado', 'Agregado'],
  ['zona', 'Zona'],
  ['poligono', 'Polígono'],
  ['parcela', 'Parcela'],
  ['recinto', 'Recinto'],
];

function refToForm(ref: SigpacReference | null): SigpacForm {
  return {
    provincia: ref?.provincia ?? '',
    municipio: ref?.municipio ?? '',
    agregado: ref?.agregado ?? '',
    zona: ref?.zona ?? '',
    poligono: ref?.poligono ?? '',
    parcela: ref?.parcela ?? '',
    recinto: ref?.recinto ?? '',
  };
}

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
  // SIGPAC parts already stored are read-only (changing them would point at
  // another recinto); missing parts — or the whole reference — can be added,
  // and are verified against the official SIGPAC service before saving.
  const [sigpacRef, setSigpacRef] = useState<SigpacReference | null>(null);
  const [hasGeometry, setHasGeometry] = useState(false);
  const [sigpacForm, setSigpacForm] = useState<SigpacForm>(refToForm(null));
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
        setSigpacRef(p.sigpacRef);
        setHasGeometry(p.geometry !== null);
        setSigpacForm(refToForm(p.sigpacRef));
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

  function sigpacEdited(): boolean {
    const stored = refToForm(sigpacRef);
    return SIGPAC_FIELDS.some(([k]) => sigpacForm[k].trim() !== stored[k]);
  }

  /** Verifica la referencia en SIGPAC; devuelve error o el patch a guardar. */
  async function verifiedSigpacPatch(): Promise<
    string | { sigpacRef: SigpacReference; geometry?: GeoJsonPolygon }
  > {
    const refOrErr = buildSigpacReference(sigpacForm);
    if (typeof refOrErr === 'string') return refOrErr;
    if (!refOrErr.recinto) return 'Indica el recinto SIGPAC (lo exige el Cuaderno Digital).';
    try {
      const result = await sigpacService.lookup(refOrErr);
      return {
        sigpacRef: result.reference,
        ...(hasGeometry ? {} : { geometry: result.geometry }),
      };
    } catch (err) {
      return `No se ha encontrado esa referencia en SIGPAC: ${
        err instanceof Error ? err.message : 'error de consulta'
      }`;
    }
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
      let sigpacPatch = {};
      if (sigpacEdited()) {
        const patchOrErr = await verifiedSigpacPatch();
        if (typeof patchOrErr === 'string') {
          setError(patchOrErr);
          return;
        }
        sigpacPatch = patchOrErr;
      }
      await parcelasService.update(parcelaId, {
        name: name.trim(),
        areaHa: area,
        ...sigpacPatch,
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

      <Text style={styles.sectionTitle}>Referencia SIGPAC</Text>
      <Text style={styles.note}>
        {sigpacRef
          ? 'Los datos que ya tiene no se pueden cambiar. Completa los que faltan; se comprueban en SIGPAC al guardar.'
          : 'Esta parcela no tiene referencia SIGPAC (la exige el Cuaderno Digital). Añádela; se comprueba en SIGPAC al guardar.'}
      </Text>
      {SIGPAC_FIELDS.map(([key, label]) => {
        const stored = sigpacRef ? refToForm(sigpacRef)[key] : '';
        return (
          <TextField
            key={key}
            label={stored ? label : `${label} — falta`}
            value={sigpacForm[key]}
            onChangeText={(v) => setSigpacForm((f) => ({ ...f, [key]: v }))}
            editable={!stored}
            keyboardType="number-pad"
          />
        );
      })}

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
    marginBottom: theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.text,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
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
