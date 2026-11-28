import {
  ACTIVIDAD_TYPE_LABELS,
  Actividad,
} from '@/services/actividades.service';
import {
  csvJoinRows,
  formatNumberEs,
  shareCsv,
  slugify,
  todayIso,
} from '@/services/csv';
import { Parcela } from '@/services/parcelas.service';
import type { SigpacReference } from '@/services/sigpac.service';

// Headers ordered general → regulated. The fitosanitario columns sit at the
// end so non-fitosanitario rows just leave them blank rather than scattering
// gaps across the sheet — readable both for the grower scanning by date and
// for an inspector filtering rows where Producto is non-empty.
const HEADERS = [
  'Fecha',
  'Parcela',
  'Referencia SIGPAC',
  'Tipo',
  'Descripción',
  'Coste (€)',
  'Producto comercial',
  'Nº registro',
  'Materia activa',
  'Dosis',
  'Unidad dosis',
  'Plaga objetivo',
  'Plazo seguridad (días)',
  'Volumen caldo (L/ha)',
  'Operador',
  'Carnet aplicador',
  'ID',
] as const;

function formatSigpacRef(ref: SigpacReference | null): string {
  if (!ref) return '';
  const tail = ref.recinto ? `:${ref.recinto}` : '';
  return `${ref.provincia}:${ref.municipio}:${ref.poligono}:${ref.parcela}${tail}`;
}

export function buildActividadesCsv(
  actividades: Actividad[],
  parcelas: Parcela[],
): string {
  const parcelasById = new Map<string, Parcela>();
  for (const p of parcelas) parcelasById.set(p.id, p);

  const rows: string[][] = [HEADERS.map((h) => h)];
  for (const a of actividades) {
    const p = parcelasById.get(a.parcelaId) ?? null;
    const f = a.fitosanitario;
    rows.push([
      a.performedAt,
      p?.name ?? '',
      p ? formatSigpacRef(p.sigpacRef) : '',
      ACTIVIDAD_TYPE_LABELS[a.type],
      a.description ?? '',
      formatNumberEs(a.costEur),
      f?.productoComercial ?? '',
      f?.numeroRegistro ?? '',
      f?.materiaActiva ?? '',
      f ? formatNumberEs(f.dosis) : '',
      f?.dosisUnidad ?? '',
      f?.plagaObjetivo ?? '',
      f ? String(f.plazoSeguridadDias) : '',
      f?.volumenCaldoLHa !== null && f?.volumenCaldoLHa !== undefined
        ? formatNumberEs(f.volumenCaldoLHa)
        : '',
      f?.operadorNombre ?? '',
      f?.operadorCarnet ?? '',
      a.id,
    ]);
  }
  return csvJoinRows(rows);
}

export async function exportActividadesCsv(
  fincaName: string,
  actividades: Actividad[],
  parcelas: Parcela[],
): Promise<void> {
  if (actividades.length === 0) {
    throw new Error('No hay actividades que exportar.');
  }
  const csv = buildActividadesCsv(actividades, parcelas);
  const fileName = `cuaderno-${slugify(fincaName) || 'finca'}-${todayIso()}.csv`;
  await shareCsv(fileName, csv, 'Exportar cuaderno de campo');
}
