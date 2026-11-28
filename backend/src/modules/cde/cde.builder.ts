import type { Actividad, Fitosanitario } from '../actividades/actividades.types';
import type { Parcela } from '../parcelas/parcelas.types';
import type { CdeProblem } from './cde.types';

// Campos del registro de tratamientos fitosanitarios del Cuaderno Digital de
// Explotación Agrícola: RD 1311/2012 Anexo III Parte I.B y Orden APA/204/2023
// Anexo II (identificación del recinto en II.7, tratamiento en II.3).
// Ni una columna más: dosis, caldo o plazo de seguridad no forman parte del
// registro oficial y se quedan en el cuaderno interno de la app.
export const CDE_COLUMNS = [
  'Fecha de tratamiento',
  'Provincia',
  'Municipio',
  'Agregado',
  'Zona',
  'Polígono',
  'Parcela',
  'Recinto',
  'Cultivo (especie)',
  'Variedad',
  'Superficie tratada (ha)',
  'Problemática fitosanitaria (plaga a controlar)',
  'Justificación de la actuación',
  'Nombre comercial del producto',
  'Nº de registro del producto',
  'Materia activa',
  'Cantidad de producto utilizada',
  'Unidad',
  'Aplicador: nombre y apellidos o razón social',
  'Aplicador: NIF',
  'Aplicador: nº inscripción ROPO',
  'Equipo de aplicación',
  'Equipo: nº inscripción ROMA',
  'Asesor: nombre y apellidos o razón social',
  'Asesor: NIF',
  'Asesor: código ROPO',
  'Asesor: fecha de validación',
  'Valoración de la eficacia',
  'Observaciones',
] as const;

type RequiredFitoField = keyof Pick<
  Fitosanitario,
  | 'cultivoEspecie'
  | 'cultivoVariedad'
  | 'superficieTratadaHa'
  | 'justificacion'
  | 'materiaActiva'
  | 'cantidadProducto'
  | 'operadorNombre'
  | 'operadorNif'
  | 'operadorRopo'
  | 'equipoDescripcion'
  | 'eficacia'
>;

const REQUIRED_FITO_FIELDS: Array<[RequiredFitoField, string]> = [
  ['cultivoEspecie', 'Cultivo (especie)'],
  ['cultivoVariedad', 'Variedad'],
  ['superficieTratadaHa', 'Superficie tratada'],
  ['justificacion', 'Justificación de la actuación'],
  ['materiaActiva', 'Materia activa'],
  ['cantidadProducto', 'Cantidad de producto utilizada'],
  ['operadorNombre', 'Nombre del aplicador'],
  ['operadorNif', 'NIF del aplicador'],
  ['operadorRopo', 'Nº ROPO del aplicador'],
  ['equipoDescripcion', 'Equipo de aplicación'],
  ['eficacia', 'Valoración de la eficacia'],
];

const ASESOR_FIELDS: Array<[keyof Fitosanitario, string]> = [
  ['asesorNombre', 'nombre'],
  ['asesorNif', 'NIF'],
  ['asesorRopo', 'código ROPO'],
  ['asesorFechaValidacion', 'fecha de validación'],
];

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function text(v: string | null | undefined): string {
  return v == null ? '' : v.trim();
}

/** Sin redondeo: el valor sale tal cual lo guardó el usuario. */
export function formatDecimalEs(n: number | null | undefined): string {
  return n == null ? '' : String(n).replace('.', ',');
}

export function isoToEsDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function parcelaProblems(p: Parcela | undefined): string[] {
  if (!p) return ['La parcela del tratamiento no existe en esta finca'];
  const ref = p.sigpacRef;
  if (!ref) return ['La parcela no tiene referencia SIGPAC'];
  const missing = (
    [
      ['agregado', ref.agregado],
      ['zona', ref.zona],
      ['recinto', ref.recinto],
    ] as const
  )
    .filter(([, v]) => isBlank(v))
    .map(([k]) => k);
  return missing.length > 0
    ? [`Referencia SIGPAC incompleta: falta ${missing.join(', ')}`]
    : [];
}

function actividadProblems(
  a: Actividad,
  p: Parcela | undefined,
  todayIso: string,
): string[] {
  const f = a.fitosanitario;
  if (!f) return ['El tratamiento no tiene datos fitosanitarios'];

  const out: string[] = [];
  const missing = REQUIRED_FITO_FIELDS.filter(([k]) => isBlank(f[k])).map(
    ([, label]) => label,
  );
  if (f.cantidadProducto != null && isBlank(f.cantidadUnidad)) {
    missing.push('Unidad de la cantidad (kg o L)');
  }
  if (missing.length > 0) out.push(`Falta: ${missing.join(', ')}`);

  const asesorMissing = ASESOR_FIELDS.filter(([k]) => isBlank(f[k])).map(
    ([, label]) => label,
  );
  if (asesorMissing.length > 0 && asesorMissing.length < ASESOR_FIELDS.length) {
    out.push(`Datos del asesor incompletos: falta ${asesorMissing.join(', ')}`);
  }

  if (
    f.superficieTratadaHa != null &&
    p?.areaHa != null &&
    f.superficieTratadaHa > p.areaHa
  ) {
    out.push(
      `La superficie tratada (${formatDecimalEs(f.superficieTratadaHa)} ha) es mayor que la de la parcela (${formatDecimalEs(p.areaHa)} ha)`,
    );
  }
  if (a.performedAt.slice(0, 10) > todayIso) {
    out.push('La fecha del tratamiento es posterior a hoy');
  }
  return out;
}

function buildRow(a: Actividad, p: Parcela, f: Fitosanitario): string[] {
  const ref = p.sigpacRef!;
  return [
    isoToEsDate(a.performedAt),
    ref.provincia,
    ref.municipio,
    text(ref.agregado),
    text(ref.zona),
    ref.poligono,
    ref.parcela,
    text(ref.recinto),
    text(f.cultivoEspecie),
    text(f.cultivoVariedad),
    formatDecimalEs(f.superficieTratadaHa),
    text(f.plagaObjetivo),
    text(f.justificacion),
    text(f.productoComercial),
    text(f.numeroRegistro),
    text(f.materiaActiva),
    formatDecimalEs(f.cantidadProducto),
    text(f.cantidadUnidad),
    text(f.operadorNombre),
    text(f.operadorNif),
    text(f.operadorRopo),
    text(f.equipoDescripcion),
    text(f.equipoRoma),
    text(f.asesorNombre),
    text(f.asesorNif),
    text(f.asesorRopo),
    isoToEsDate(f.asesorFechaValidacion),
    text(f.eficacia),
    text(a.description),
  ];
}

export interface CdeBuildResult {
  rows: string[][];
  problems: CdeProblem[];
}

/**
 * Convierte tratamientos en filas del CDE. Nunca rellena un dato que falte:
 * cada hueco obligatorio se devuelve como problema para que el usuario lo
 * complete en la app.
 */
export function buildCdeRows(
  actividades: Actividad[],
  parcelas: Parcela[],
  todayIso: string,
): CdeBuildResult {
  const parcelasById = new Map(parcelas.map((p) => [p.id, p]));
  const fitos = actividades
    .filter((a) => a.type === 'tratamiento_fitosanitario')
    .sort((x, y) =>
      x.performedAt === y.performedAt
        ? x.id.localeCompare(y.id)
        : x.performedAt.localeCompare(y.performedAt),
    );

  const rows: string[][] = [];
  const problems: CdeProblem[] = [];

  for (const a of fitos) {
    const p = parcelasById.get(a.parcelaId);
    const base = {
      actividadId: a.id,
      parcelaId: a.parcelaId,
      parcelaName: p?.name ?? '',
      fecha: a.performedAt,
      producto: a.fitosanitario?.productoComercial ?? null,
    };

    const pProblems = parcelaProblems(p);
    if (pProblems.length > 0) problems.push({ ...base, fixIn: 'parcela', messages: pProblems });

    const aProblems = actividadProblems(a, p, todayIso);
    if (aProblems.length > 0) problems.push({ ...base, fixIn: 'actividad', messages: aProblems });

    if (pProblems.length === 0 && aProblems.length === 0 && p && a.fitosanitario) {
      rows.push(buildRow(a, p, a.fitosanitario));
    }
  }

  return { rows, problems };
}

function csvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** `;` como separador (Excel en español) y CRLF (RFC 4180). */
export function toCsv(columns: readonly string[], rows: string[][]): string {
  return [columns as readonly string[], ...rows]
    .map((r) => r.map(csvCell).join(';'))
    .join('\r\n');
}
