import { StyleSheet, Text, View } from 'react-native';

import { TextField } from '@/components/TextField';
import {
  FITOSANITARIO_DOSIS_UNITS,
  Fitosanitario,
  FitosanitarioDosisUnit,
} from '@/services/actividades.service';
import { theme } from '@/theme';

// String-form mirror of Fitosanitario: every field is a TextField string so
// validation lives in one place (parseFitosanitarioDraft) and the parent screen
// doesn't have to special-case "user typed '12,5' but the API expects 12.5".
export interface FitosanitarioDraft {
  productoComercial: string;
  numeroRegistro: string;
  materiaActiva: string;
  dosis: string;
  dosisUnidad: FitosanitarioDosisUnit;
  plagaObjetivo: string;
  plazoSeguridadDias: string;
  volumenCaldoLHa: string;
  operadorNombre: string;
  operadorCarnet: string;
}

export const EMPTY_FITOSANITARIO_DRAFT: FitosanitarioDraft = {
  productoComercial: '',
  numeroRegistro: '',
  materiaActiva: '',
  dosis: '',
  dosisUnidad: 'L/ha',
  plagaObjetivo: '',
  plazoSeguridadDias: '',
  volumenCaldoLHa: '',
  operadorNombre: '',
  operadorCarnet: '',
};

export function fitosanitarioToDraft(
  f: Fitosanitario | null | undefined,
): FitosanitarioDraft {
  if (!f) return EMPTY_FITOSANITARIO_DRAFT;
  return {
    productoComercial: f.productoComercial,
    numeroRegistro: f.numeroRegistro,
    materiaActiva: f.materiaActiva ?? '',
    dosis: f.dosis !== null && f.dosis !== undefined ? String(f.dosis) : '',
    dosisUnidad: f.dosisUnidad,
    plagaObjetivo: f.plagaObjetivo,
    plazoSeguridadDias:
      f.plazoSeguridadDias !== null && f.plazoSeguridadDias !== undefined
        ? String(f.plazoSeguridadDias)
        : '',
    volumenCaldoLHa:
      f.volumenCaldoLHa !== null && f.volumenCaldoLHa !== undefined
        ? String(f.volumenCaldoLHa)
        : '',
    operadorNombre: f.operadorNombre ?? '',
    operadorCarnet: f.operadorCarnet ?? '',
  };
}

function parseEsNumber(raw: string): number | null {
  const trimmed = raw.replace(',', '.').trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export interface FitosanitarioParseResult {
  value?: Fitosanitario;
  error?: string;
}

// Returns parsed value or a Spanish-language error string suitable for the
// form's existing error banner. Strict on required fields, lenient on optional
// ones (empty → null).
export function parseFitosanitarioDraft(
  d: FitosanitarioDraft,
): FitosanitarioParseResult {
  const productoComercial = d.productoComercial.trim();
  const numeroRegistro = d.numeroRegistro.trim();
  const plagaObjetivo = d.plagaObjetivo.trim();

  if (productoComercial.length === 0) {
    return { error: 'Indica el producto comercial.' };
  }
  if (numeroRegistro.length === 0) {
    return { error: 'Indica el nº de registro del producto.' };
  }
  if (plagaObjetivo.length === 0) {
    return { error: 'Indica la plaga / enfermedad objetivo.' };
  }

  const dosis = parseEsNumber(d.dosis);
  if (dosis === null || dosis <= 0) {
    return { error: 'Dosis inválida (mayor que 0).' };
  }

  const plazo = parseEsNumber(d.plazoSeguridadDias);
  if (plazo === null || plazo < 0 || !Number.isInteger(plazo) || plazo > 365) {
    return { error: 'Plazo de seguridad inválido (días entre 0 y 365).' };
  }

  let volumenCaldoLHa: number | null = null;
  if (d.volumenCaldoLHa.trim().length > 0) {
    const v = parseEsNumber(d.volumenCaldoLHa);
    if (v === null || v <= 0) {
      return { error: 'Volumen de caldo inválido (L/ha mayor que 0).' };
    }
    volumenCaldoLHa = v;
  }

  const materiaActiva = d.materiaActiva.trim();
  const operadorNombre = d.operadorNombre.trim();
  const operadorCarnet = d.operadorCarnet.trim();

  const value: Fitosanitario = {
    productoComercial,
    numeroRegistro,
    materiaActiva: materiaActiva.length > 0 ? materiaActiva : null,
    dosis,
    dosisUnidad: d.dosisUnidad,
    plagaObjetivo,
    plazoSeguridadDias: plazo,
    volumenCaldoLHa,
    operadorNombre: operadorNombre.length > 0 ? operadorNombre : null,
    operadorCarnet: operadorCarnet.length > 0 ? operadorCarnet : null,
  };
  return { value };
}

interface Props {
  value: FitosanitarioDraft;
  onChange: (next: FitosanitarioDraft) => void;
  disabled?: boolean;
}

export function FitosanitarioFields({
  value,
  onChange,
  disabled,
}: Props): JSX.Element {
  function patch<K extends keyof FitosanitarioDraft>(
    key: K,
    next: FitosanitarioDraft[K],
  ): void {
    onChange({ ...value, [key]: next });
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>Cuaderno fitosanitario</Text>
      <Text style={styles.sectionHint}>
        Datos requeridos por el RD 1311/2012. Quedan registrados de forma
        estructurada para inspecciones y exportación.
      </Text>

      <TextField
        label="Producto comercial *"
        value={value.productoComercial}
        onChangeText={(t) => patch('productoComercial', t)}
        editable={!disabled}
        placeholder="Ej. Karate Zeon 10 CS"
      />
      <TextField
        label="Nº registro (ROPO/MAPA) *"
        value={value.numeroRegistro}
        onChangeText={(t) => patch('numeroRegistro', t)}
        editable={!disabled}
        autoCapitalize="characters"
        placeholder="Ej. 23339"
      />
      <TextField
        label="Materia activa — opcional"
        value={value.materiaActiva}
        onChangeText={(t) => patch('materiaActiva', t)}
        editable={!disabled}
        placeholder="Ej. lambda cihalotrín 10%"
      />

      <View style={styles.row}>
        <View style={styles.dosisField}>
          <TextField
            label="Dosis *"
            value={value.dosis}
            onChangeText={(t) => patch('dosis', t)}
            editable={!disabled}
            keyboardType="decimal-pad"
            placeholder="Ej. 0,5"
          />
        </View>
        <View style={styles.dosisUnitField}>
          <Text style={styles.unitLabel}>Unidad</Text>
          <View style={styles.chipsRow}>
            {FITOSANITARIO_DOSIS_UNITS.map((u) => {
              const selected = u === value.dosisUnidad;
              return (
                <Text
                  key={u}
                  onPress={() => !disabled && patch('dosisUnidad', u)}
                  style={[
                    styles.unitChip,
                    selected && styles.unitChipSelected,
                  ]}
                >
                  {u}
                </Text>
              );
            })}
          </View>
        </View>
      </View>

      <TextField
        label="Plaga / enfermedad objetivo *"
        value={value.plagaObjetivo}
        onChangeText={(t) => patch('plagaObjetivo', t)}
        editable={!disabled}
        placeholder="Ej. mosca del olivo (Bactrocera oleae)"
      />
      <TextField
        label="Plazo de seguridad (días) *"
        value={value.plazoSeguridadDias}
        onChangeText={(t) => patch('plazoSeguridadDias', t)}
        editable={!disabled}
        keyboardType="number-pad"
        placeholder="Ej. 21"
      />
      <TextField
        label="Volumen de caldo (L/ha) — opcional"
        value={value.volumenCaldoLHa}
        onChangeText={(t) => patch('volumenCaldoLHa', t)}
        editable={!disabled}
        keyboardType="decimal-pad"
        placeholder="Ej. 1000"
      />
      <TextField
        label="Operador / aplicador — opcional"
        value={value.operadorNombre}
        onChangeText={(t) => patch('operadorNombre', t)}
        editable={!disabled}
        placeholder="Nombre y apellidos"
      />
      <TextField
        label="Carnet de aplicador — opcional"
        value={value.operadorCarnet}
        onChangeText={(t) => patch('operadorCarnet', t)}
        editable={!disabled}
        autoCapitalize="characters"
        placeholder="Ej. JAE-12345"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  sectionHint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: theme.spacing.md,
    lineHeight: 16,
  },
  row: {
    flexDirection: 'row',
  },
  dosisField: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  dosisUnitField: {
    flex: 1.2,
  },
  unitLabel: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginBottom: theme.spacing.xs,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  unitChip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    marginRight: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
    fontSize: 12,
    overflow: 'hidden',
  },
  unitChipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    color: theme.colors.primaryText,
  },
});
