import { Campana, campanasService } from '@/services/campanas.service';
import {
  CampanaSummary,
  transaccionesService,
} from '@/services/transacciones.service';

/**
 * Per-finca finance aggregation. Sits on top of the existing per-campaign
 * `summary` endpoint — N+1 calls (1 list campaigns + N summaries) for a
 * finca with N campaigns. With the typical 1-3 active campaigns per finca
 * this is negligible; if usage shows users keeping a long tail of historical
 * campaigns open, replace the per-campaign loop with a single backend
 * `/transacciones/finca-summary/:fincaId` aggregator.
 *
 * Kept separate from `dashboardStats.service` because that one is shaped
 * around the home dashboard's "across all fincas" view and bundles fetches
 * (parcelas/actividades/tickets) the FincaDetail screen doesn't need a
 * second time. Splitting avoids mixing concerns and lets each surface
 * evolve independently.
 */

export interface CampanaWithSummary {
  campana: Campana;
  summary: CampanaSummary;
}

export interface FincaFinanceStats {
  /** One entry per campaign of the finca, with its individual totals. */
  campanas: CampanaWithSummary[];
  totalIngresos: number;
  totalGastos: number;
  balance: number;
}

function emptyStats(): FincaFinanceStats {
  return { campanas: [], totalIngresos: 0, totalGastos: 0, balance: 0 };
}

export async function fetchFincaFinanceStats(
  fincaId: string,
): Promise<FincaFinanceStats> {
  const campanas = await campanasService.listByFinca(fincaId);
  if (campanas.length === 0) return emptyStats();

  const summaries = await Promise.all(
    campanas.map((c) =>
      transaccionesService
        .summary(c.id)
        .then((summary) => ({ campana: c, summary })),
    ),
  );

  let totalIngresos = 0;
  let totalGastos = 0;
  for (const cs of summaries) {
    totalIngresos += cs.summary.totalIngresos;
    totalGastos += cs.summary.totalGastos;
  }

  // Sort by startDate desc — newest campaign first matches the user's mental
  // model when scanning ("how is THIS year going" comes before "what did I
  // make in 2022"). Stable tiebreaker on id so the list doesn't reshuffle on
  // refresh when two campaigns share the same start.
  summaries.sort((a, b) => {
    if (a.campana.startDate !== b.campana.startDate)
      return a.campana.startDate > b.campana.startDate ? -1 : 1;
    return a.campana.id < b.campana.id ? 1 : -1;
  });

  return {
    campanas: summaries,
    totalIngresos,
    totalGastos,
    balance: totalIngresos - totalGastos,
  };
}

/**
 * Narrow a `FincaFinanceStats` to campaigns that overlap with the current
 * calendar year. "Overlap" = endDate >= Jan 1 of current year, i.e. the
 * campaign hasn't fully ended before this year started. We deliberately
 * include campaigns that started in a previous year and rolled over (the
 * common olivar case: campaña 2025-2026 spans Sep 2025 → Aug 2026, and
 * "this year" should include both halves).
 *
 * Counter-case we intentionally don't filter out: a campaign that started
 * mid-year — its full lifetime totals are shown, not just the YTD slice.
 * For finer-grained YTD detail per campaign, the user drills into the
 * CampanaDetail screen which has period chips of its own.
 */
export function filterFinanceStatsYearToDate(
  stats: FincaFinanceStats,
): FincaFinanceStats {
  const yearStart = `${new Date().getFullYear()}-01-01`;
  // An open-ended campaign (endDate === null) is by definition still
  // running, so it always overlaps the current year.
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
