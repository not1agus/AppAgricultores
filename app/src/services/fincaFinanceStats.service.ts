import { api } from '@/services/api';
import { CampanaSummary } from '@/services/transacciones.service';

export interface CampanaInfo {
  id: string;
  fincaId: string;
  name: string;
  startDate: string;
  endDate: string | null;
}

export interface CampanaWithSummary {
  campana: CampanaInfo;
  summary: CampanaSummary;
}

export interface FincaFinanceStats {
  campanas: CampanaWithSummary[];
  totalIngresos: number;
  totalGastos: number;
  balance: number;
}

export async function fetchFincaFinanceStats(
  fincaId: string,
): Promise<FincaFinanceStats> {
  return api.get<FincaFinanceStats>(`/rentabilidad/finca/${fincaId}`);
}

/**
 * Narrow a `FincaFinanceStats` to campaigns that overlap with the current
 * calendar year. "Overlap" = endDate >= Jan 1 of current year, i.e. the
 * campaign hasn't fully ended before this year started. We deliberately
 * include campaigns that started in a previous year and rolled over (the
 * common olivar case: campaña 2025-2026 spans Sep 2025 → Aug 2026, and
 * "this year" should include both halves).
 */
export function filterFinanceStatsYearToDate(
  stats: FincaFinanceStats,
): FincaFinanceStats {
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const filtered = stats.campanas.filter(
    (cs) => cs.campana.endDate === null || cs.campana.endDate >= yearStart,
  );
  let totalIngresos = 0;
  let totalGastos = 0;
  for (const cs of filtered) {
    totalIngresos += cs.summary.totalIngresos;
    totalGastos += cs.summary.totalGastos;
  }
  return {
    campanas: filtered,
    totalIngresos,
    totalGastos,
    balance: totalIngresos - totalGastos,
  };
}
