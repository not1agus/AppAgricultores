/**
 * Exportación compatible con el Cuaderno de Explotación Digital (CDE) del MAPA.
 *
 * El CDE (RD 1311/2012, actualizado por RD 1/2023) obliga a registrar los
 * tratamientos fitosanitarios antes de 7 días tras la aplicación. Este
 * exportador genera un CSV con las columnas que el portal CDE del MAPA acepta
 * para importación de tratamientos.
 *
 * Solo se incluyen actividades de tipo 'tratamiento_fitosanitario'; el resto
 * (riego, poda…) no pertenece a este apartado del cuaderno oficial.
 */
import { Actividad } from '@/services/actividades.service';
import {
  csvJoinRows,
  formatNumberEs,
  shareCsv,
  slugify,
  todayIso,
} from '@/services/csv';
import { Parcela } from '@/services/parcelas.service';
import type { SigpacReference } from '@/services/sigpac.service';

// Cultivo fijo para esta aplicación (gestión de olivar).
const CULTIVO_OLIVAR = 'Olivar';

const CDE_HEADERS = [
  'Explotación',
  'Parcela',
  'Referencia SIGPAC',
  'Cultivo',
  'Superficie tratada (ha)',
  'Fecha aplicación',
  'Producto comercial',
  'Nº Registro ROPO',
  'Materia activa',
  'Dosis',
  'Unidad dosis',
  'Volumen caldo (L/ha)',
  'Plaga/Enfermedad/Adventicias',
  'Plazo seguridad (días)',
  'Nombre aplicador',
  'Nº ROPO aplicador',
  'Observaciones',
] as const;

function formatSigpacRef(ref: SigpacReference | null): string {
  if (!ref) return '';
  const tail = ref.recinto ? `:${ref.recinto}` : '';
  return `${ref.provincia}:${ref.municipio}:${ref.poligono}:${ref.parcela}${tail}`;
}

export function buildCdeFitosanitariosCsv(
  fincaName: string,
  actividades: Actividad[],
  parcelas: Parcela[],
): string {
  const parcelasById = new Map<string, Parcela>();
  for (const p of parcelas) parcelasById.set(p.id, p);

  const rows: string[][] = [CDE_HEADERS.map((h) => h)];

  for (const a of actividades) {
    if (a.type !== 'tratamiento_fitosanitario' || !a.fitosanitario) continue;

    const p = parcelasById.get(a.parcelaId) ?? null;
    const f = a.fitosanitario;

    rows.push([
      fincaName,
      p?.name ?? '',
      p ? formatSigpacRef(p.sigpacRef) : '',
      CULTIVO_OLIVAR,
      p?.areaHa !== null && p?.areaHa !== undefined
        ? formatNumberEs(p.areaHa)
        : '',
      a.performedAt,
      f.productoComercial,
      f.numeroRegistro,
      f.materiaActiva ?? '',
      formatNumberEs(f.dosis),
      f.dosisUnidad,
      f.volumenCaldoLHa !== null && f.volumenCaldoLHa !== undefined
        ? formatNumberEs(f.volumenCaldoLHa)
        : '',
      f.plagaObjetivo,
      String(f.plazoSeguridadDias),
      f.operadorNombre ?? '',
      f.operadorCarnet ?? '',
      a.description ?? '',
    ]);
  }

  return csvJoinRows(rows);
}

export async function exportCdeFitosanitariosCsv(
  fincaName: string,
  actividades: Actividad[],
  parcelas: Parcela[],
): Promise<void> {
  const fitos = actividades.filter(
    (a) => a.type === 'tratamiento_fitosanitario',
  );
  if (fitos.length === 0) {
    throw new Error(
      'No hay tratamientos fitosanitarios en el periodo seleccionado.',
    );
  }
  const csv = buildCdeFitosanitariosCsv(fincaName, actividades, parcelas);
  const fileName = `cde-fitosanitarios-${slugify(fincaName) || 'finca'}-${todayIso()}.csv`;
  await shareCsv(fileName, csv, 'Exportar para CDE (MAPA)');
}
