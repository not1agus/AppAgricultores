/**
 * Pure rentabilidad (profitability) calculations — no I/O, no side effects.
 * Extracted so they can be unit-tested independently of the full service.
 */

import { CampanaSummary } from './transacciones.types';

export interface TransaccionRow {
  kind: 'ingreso' | 'gasto';
  amount_eur: string | number;
}

/**
 * Compute the financial summary for a campaign from a list of raw DB rows.
 * Returns totalIngresos, totalGastos and balance (ingresos − gastos).
 */
export function computeCampanaSummary(
  campanaId: string,
  rows: TransaccionRow[],
): CampanaSummary {
  let totalIngresos = 0;
  let totalGastos = 0;

  for (const row of rows) {
    const amount = Number(row.amount_eur);
    if (!Number.isFinite(amount)) continue;
    if (row.kind === 'ingreso') {
      totalIngresos += amount;
    } else {
      totalGastos += amount;
    }
  }

  return {
    campanaId,
    totalIngresos,
    totalGastos,
    balance: totalIngresos - totalGastos,
    count: rows.length,
  };
}
