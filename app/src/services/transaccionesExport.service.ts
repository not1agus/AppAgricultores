import { Campana } from '@/services/campanas.service';
import {
  csvJoinRows,
  formatNumberEs,
  shareCsv,
  slugify,
  todayIso,
} from '@/services/csv';
import {
  CampanaSummary,
  Transaccion,
} from '@/services/transacciones.service';

/**
 * Exports a campaña's transacciones as a CSV aimed at the user's gestor /
 * accountant. Includes a summary block at the top (ingresos, gastos,
 * balance) plus the per-row movements. Signed amounts are split into two
 * columns (Ingreso / Gasto) so SUM() in Excel gives meaningful totals
 * without needing IF(kind='ingreso', ...) gymnastics.
 */

const HEADERS = [
  'Fecha',
  'Tipo',
  'Categoría',
  'Descripción',
  'Ingreso (€)',
  'Gasto (€)',
  'ID',
] as const;

function summaryRows(
  campana: Campana,
  summary: CampanaSummary | null,
): string[][] {
  return [
    ['Campaña', campana.name],
    ['Periodo', `${campana.startDate} a ${campana.endDate ?? 'en curso'}`],
    ['Movimientos', String(summary?.count ?? 0)],
    ['Total ingresos (€)', formatNumberEs(summary?.totalIngresos ?? 0)],
    ['Total gastos (€)', formatNumberEs(summary?.totalGastos ?? 0)],
    ['Balance (€)', formatNumberEs(summary?.balance ?? 0)],
    [], // blank separator row before the headers
  ];
}

export function buildTransaccionesCsv(
  campana: Campana,
  summary: CampanaSummary | null,
  transacciones: Transaccion[],
): string {
  const rows: string[][] = [...summaryRows(campana, summary)];
  rows.push(HEADERS.map((h) => h));
  for (const t of transacciones) {
    rows.push([
      t.occurredAt,
      t.kind === 'ingreso' ? 'Ingreso' : 'Gasto',
      t.category,
      t.description ?? '',
      t.kind === 'ingreso' ? formatNumberEs(t.amountEur) : '',
      t.kind === 'gasto' ? formatNumberEs(t.amountEur) : '',
      t.id,
    ]);
  }
  return csvJoinRows(rows);
}

export async function exportTransaccionesCsv(
  campana: Campana,
  summary: CampanaSummary | null,
  transacciones: Transaccion[],
): Promise<void> {
  if (transacciones.length === 0) {
    throw new Error('No hay movimientos que exportar.');
  }
  const csv = buildTransaccionesCsv(campana, summary, transacciones);
  const fileName = `campana-${slugify(campana.name) || 'sin-nombre'}-${todayIso()}.csv`;
  await shareCsv(fileName, csv, 'Exportar movimientos de campaña');
}
