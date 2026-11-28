import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TextField } from '@/components/TextField';
import {
  CANTIDAD_UNIDADES,
  CantidadUnidad,
  FITOSANITARIO_DOSIS_UNITS,
  Fitosanitario,
  FitosanitarioDosisUnit,
  NIF_RE,
} from '@/services/actividades.service';
import { theme } from '@/theme';

// String-form mirror of Fitosanitario: every field is a TextField string so
// validation lives in one place (parseFitosanitarioDraft). Units start empty
// on purpose — the user must pick one, nothing is preselected for them.
export interface FitosanitarioDraft {
  productoComercial: string;
  numeroRegistro: string;
  materiaActiva: string;
  dosis: string;
  dosisUnidad: FitosanitarioDosisUnit | '';
  plagaObjetivo: string;
  plazoSeguridadDias: string;
  volumenCaldoLHa: string;
  operadorNombre: string;
  operadorCarnet: string;
  cultivoEspecie: string;
  cultivoVariedad: string;
  superficieTratadaHa: string;
  justificacion: string;
  cantidadProducto: string;
  cantidadUnidad: CantidadUnidad | '';
  operadorNif: string;
  operadorRopo: string;
  equipoDescripcion: string;
  equipoRoma: string;
  eficacia: string;
  asesorNombre: string;
  asesorNif: string;
  asesorRopo: string;
  asesorFechaValidacion: string;
}

export const EMPTY_FITOSANITARIO_DRAFT: FitosanitarioDraft = {
  productoComercial: '',
  numeroRegistro: '',
  materiaActiva: '',
  dosis: '',
  dosisUnidad: '',
  plagaObjetivo: '',
  plazoSeguridadDias: '',
  volumenCaldoLHa: '',
  operadorNombre: '',
  operadorCarnet: '',
  cultivoEspecie: '',
  cultivoVariedad: '',
  superficieTratadaHa: '',
  justificacion: '',
  cantidadProducto: '',
  cantidadUnidad: '',
  operadorNif: '',
  operadorRopo: '',
  equipoDescripcion: '',
  equipoRoma: '',
  eficacia: '',
  asesorNombre: '',
  asesorNif: '',
  asesorRopo: '',
  asesorFechaValidacion: '',
};

function numToDraft(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n).replace('.', ',');
}

export function fitosanitarioToDraft(
  f: Fitosanitario | null | undefined,
): FitosanitarioDraft {
  if (!f) return EMPTY_FITOSANITARIO_DRAFT;
  return {
    productoComercial: f.productoComercial,
    numeroRegistro: f.numeroRegistro,
    materiaActiva: f.materiaActiva ?? '',
    dosis: numToDraft(f.dosis),
    dosisUnidad: f.dosisUnidad,
    plagaObjetivo: f.plagaObjetivo,
    plazoSeguridadDias: numToDraft(f.plazoSeguridadDias),
    volumenCaldoLHa: numToDraft(f.volumenCaldoLHa),
    operadorNombre: f.operadorNombre ?? '',
    operadorCarnet: f.operadorCarnet ?? '',
    cultivoEspecie: f.cultivoEspecie ?? '',
    cultivoVariedad: f.cultivoVariedad ?? '',
    superficieTratadaHa: numToDraft(f.superficieTratadaHa),
    justificacion: f.justificacion ?? '',
    cantidadProducto: numToDraft(f.cantidadProducto),
    cantidadUnidad: f.cantidadUnidad ?? '',
    operadorNif: f.operadorNif ?? '',
    operadorRopo: f.operadorRopo ?? '',
    equipoDescripcion: f.equipoDescripcion ?? '',
    equipoRoma: f.equipoRoma ?? '',
    eficacia: f.eficacia ?? '',
    asesorNombre: f.asesorNombre ?? '',
    asesorNif: f.asesorNif ?? '',
    asesorRopo: f.asesorRopo ?? '',
    asesorFechaValidacion: f.asesorFechaValidacion ?? '',
  };
}

function parseEsNumber(raw: string): number | null {
  const trimmed = raw.replace(',', '.').trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function orNull(s: string): string | null {
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export interface FitosanitarioParseResult {
  value?: Fitosanitario;
  error?: string;
}

// Strict on required fields and on the format of anything the user typed;
// CDE fields may stay empty here (the CDE export is what demands them).
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
  if (d.dosisUnidad === '') {
    return { error: 'Elige la unidad de la dosis.' };
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

  let superficieTratadaHa: number | null = null;
  if (d.superficieTratadaHa.trim().length > 0) {
    const v = parseEsNumber(d.superficieTratadaHa);
    if (v === null || v <= 0) {
      return { error: 'Superficie tratada inválida (hectáreas mayor que 0).' };
    }
    superficieTratadaHa = v;
  }

  let cantidadProducto: number | null = null;
  if (d.cantidadProducto.trim().length > 0) {
    const v = parseEsNumber(d.cantidadProducto);
    if (v === null || v <= 0) {
      return { error: 'Cantidad de producto inválida (mayor que 0).' };
    }
    cantidadProducto = v;
  }
  if ((cantidadProducto === null) !== (d.cantidadUnidad === '')) {
    return {
      error:
        cantidadProducto === null
          ? 'Indica la cantidad de producto o quita la unidad.'
          : 'Elige la unidad de la cantidad de producto (kg o L).',
    };
  }

  const operadorNif = orNull(d.operadorNif)?.toUpperCase() ?? null;
  if (operadorNif !== null && !NIF_RE.test(operadorNif)) {
    return { error: 'NIF del aplicador con formato inválido.' };
  }
  const asesorNif = orNull(d.asesorNif)?.toUpperCase() ?? null;
  if (asesorNif !== null && !NIF_RE.test(asesorNif)) {
    return { error: 'NIF del asesor con formato inválido.' };
  }
  const asesorFechaValidacion = orNull(d.asesorFechaValidacion);
  if (
    asesorFechaValidacion !== null &&
    !/^\d{4}-\d{2}-\d{2}$/.test(asesorFechaValidacion)
  ) {
    return { error: 'Fecha de validación del asesor inválida (YYYY-MM-DD).' };
  }

  const value: Fitosanitario = {
    productoComercial,
    numeroRegistro,
    materiaActiva: orNull(d.materiaActiva),
    dosis,
    dosisUnidad: d.dosisUnidad,
    plagaObjetivo,
    plazoSeguridadDias: plazo,
    volumenCaldoLHa,
    operadorNombre: orNull(d.operadorNombre),
    operadorCarnet: orNull(d.operadorCarnet),
    cultivoEspecie: orNull(d.cultivoEspecie),
    cultivoVariedad: orNull(d.cultivoVariedad),
    superficieTratadaHa,
    justificacion: orNull(d.justificacion),
    cantidadProducto,
    cantidadUnidad: d.cantidadUnidad === '' ? null : d.cantidadUnidad,
    operadorNif,
    operadorRopo: orNull(d.operadorRopo),
    equipoDescripcion: orNull(d.equipoDescripcion),
    equipoRoma: orNull(d.equipoRoma),
    eficacia: orNull(d.eficacia),
    asesorNombre: orNull(d.asesorNombre),
    asesorNif,
    asesorRopo: orNull(d.asesorRopo),
    asesorFechaValidacion,
  };
  return { value };
}

interface Props {
  value: FitosanitarioDraft;
  onChange: (next: FitosanitarioDraft) => void;
  disabled?: boolean;
  /** Superficie registrada de la parcela, para ofrecerla (nunca aplicarla sola). */
  parcelaAreaHa?: number | null;
  /** Aviso cuando algún campo se ha copiado de datos previos del usuario. */
  prefillNote?: string | null;
}

function Chips<T extends string>({
  label,
  options,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  options: readonly T[];
  selected: T | '';
  onSelect: (v: T) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <View>
      <Text style={styles.unitLabel}>{label}</Text>
      <View style={styles.chipsRow}>
        {options.map((u) => (
          <Text
            key={u}
            onPress={() => !disabled && onSelect(u)}
            style={[styles.unitChip, u === selected && styles.unitChipSelected]}
          >
            {u}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function FitosanitarioFields({
  value,
  onChange,
  disabled,
  parcelaAreaHa,
  prefillNote,
}: Props): JSX.Element {
  function patch<K extends keyof FitosanitarioDraft>(
    key: K,
    next: FitosanitarioDraft[K],
  ): void {
    onChange({ ...value, [key]: next });
  }

  const field = (
    key: keyof FitosanitarioDraft,
    label: string,
    extra: Partial<ComponentProps<typeof TextField>> = {},
  ) => (
    <TextField
      label={label}
      value={value[key]}
      onChangeText={(t) => patch(key, t as never)}
      editable={!disabled}
      {...extra}
    />
  );

  const multiline = { multiline: true, style: styles.multiline } as const;
  const areaText =
    parcelaAreaHa != null ? String(parcelaAreaHa).replace('.', ',') : null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>Cuaderno fitosanitario</Text>
      <Text style={styles.sectionHint}>
        * = obligatorio para guardar. CDE = obligatorio para exportar al
        Cuaderno Digital de Explotación (RD 1311/2012 y Orden APA/204/2023).
        Puedes guardar sin los datos CDE y completarlos después.
      </Text>

      {field('productoComercial', 'Producto comercial *', {
        placeholder: 'Nombre que figura en la etiqueta',
      })}
      {field('numeroRegistro', 'Nº de registro del producto *', {
        autoCapitalize: 'characters',
        placeholder: 'Registro de Productos Fitosanitarios',
      })}
      {field('materiaActiva', 'Materia activa — CDE', {
        placeholder: 'Según la etiqueta',
      })}

      <View style={styles.row}>
        <View style={styles.dosisField}>
          {field('dosis', 'Dosis *', { keyboardType: 'decimal-pad' })}
        </View>
        <View style={styles.dosisUnitField}>
          <Chips
            label="Unidad de dosis *"
            options={FITOSANITARIO_DOSIS_UNITS}
            selected={value.dosisUnidad}
            onSelect={(u) => patch('dosisUnidad', u)}
            disabled={disabled}
          />
        </View>
      </View>

      {field('plagaObjetivo', 'Plaga / enfermedad a controlar *')}
      {field('justificacion', 'Justificación de la actuación — CDE', {
        ...multiline,
        placeholder: 'Por qué se trata (observación, umbral, aviso…)',
      })}
      {field('plazoSeguridadDias', 'Plazo de seguridad (días) *', {
        keyboardType: 'number-pad',
      })}
      {field('volumenCaldoLHa', 'Volumen de caldo (L/ha) — opcional', {
        keyboardType: 'decimal-pad',
      })}

      <Text style={styles.groupTitle}>Cultivo y superficie</Text>
      {prefillNote ? <Text style={styles.prefill}>{prefillNote}</Text> : null}
      {field('cultivoEspecie', 'Cultivo (especie) — CDE')}
      {field('cultivoVariedad', 'Variedad — CDE')}
      {field('superficieTratadaHa', 'Superficie tratada (ha) — CDE', {
        keyboardType: 'decimal-pad',
      })}
      {areaText && value.superficieTratadaHa.trim() === '' && !disabled ? (
        <Text
          style={styles.linkAction}
          onPress={() => patch('superficieTratadaHa', areaText)}
        >
          Se trató la parcela entera: usar {areaText} ha
        </Text>
      ) : null}

      <Text style={styles.groupTitle}>Cantidad de producto utilizada</Text>
      <View style={styles.row}>
        <View style={styles.dosisField}>
          {field('cantidadProducto', 'Cantidad total — CDE', {
            keyboardType: 'decimal-pad',
          })}
        </View>
        <View style={styles.dosisUnitField}>
          <Chips
            label="Unidad — CDE"
            options={CANTIDAD_UNIDADES}
            selected={value.cantidadUnidad}
            onSelect={(u) => patch('cantidadUnidad', u)}
            disabled={disabled}
          />
        </View>
      </View>

      <Text style={styles.groupTitle}>Aplicador</Text>
      {field('operadorNombre', 'Nombre y apellidos o razón social — CDE')}
      {field('operadorNif', 'NIF — CDE', { autoCapitalize: 'characters' })}
      {field('operadorRopo', 'Nº de inscripción ROPO — CDE', {
        autoCapitalize: 'characters',
      })}
      {field('operadorCarnet', 'Nº carné de aplicador — opcional', {
        autoCapitalize: 'characters',
      })}

      <Text style={styles.groupTitle}>Equipo de aplicación</Text>
      {field('equipoDescripcion', 'Equipo (tipo, marca, modelo) — CDE')}
      {field('equipoRoma', 'Nº inscripción ROMA — si lo tiene', {
        autoCapitalize: 'characters',
      })}

      <Text style={styles.groupTitle}>Resultado</Text>
      {field('eficacia', 'Valoración de la eficacia — CDE', {
        ...multiline,
        placeholder: 'Puedes rellenarlo días después del tratamiento',
      })}

      <Text style={styles.groupTitle}>Asesor (solo si interviene)</Text>
      <Text style={styles.sectionHint}>
        Si rellenas un dato del asesor, el CDE exige los cuatro.
      </Text>
      {field('asesorNombre', 'Nombre y apellidos o razón social')}
      {field('asesorNif', 'NIF', { autoCapitalize: 'characters' })}
      {field('asesorRopo', 'Código ROPO', { autoCapitalize: 'characters' })}
      {field('asesorFechaValidacion', 'Fecha de validación (YYYY-MM-DD)', {
        autoCapitalize: 'none',
        keyboardType: 'numbers-and-punctuation',
      })}
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
  groupTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.text,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: theme.spacing.md,
    lineHeight: 16,
  },
  prefill: {
    color: theme.colors.text,
    backgroundColor: '#FFF3CD',
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    fontSize: 12,
    marginBottom: theme.spacing.md,
  },
  linkAction: {
    color: theme.colors.primary,
    fontWeight: '600',
    fontSize: 13,
    marginTop: -theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  multiline: {
    height: 80,
    paddingTop: theme.spacing.sm,
    textAlignVertical: 'top',
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
