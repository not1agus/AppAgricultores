import { actividadesService } from '@/services/actividades.service';
import type { Parcela } from '@/services/parcelas.service';

/**
 * Per-parcela activity stats for the parcelas list dashboard. One call per
 * parcela (filtered list of activities in the last STALE_DAYS window).
 *
 * Cost: N round-trips per finca (one per parcela). With the typical 1-10
 * parcelas this is acceptable for a one-shot screen entry; for fincas with
 * 50+ parcelas (large operations) this would justify a backend
 * `/parcelas/:fincaId/activity-summary` aggregator. Flagged here in case
 * usage shows it.
 *
 * Kept separate from `dashboardStats.service` (which is per-finca for the
 * home) and `fincaFinanceStats.service` (which is finance-only): each
 * surface aggregates a different cut of the same underlying data, and
 * splitting keeps each consumer's failure modes independent.
 */

/** Window we look at for "recent activity". 90 days covers the typical
 * gap between major olivar interventions (poda en invierno, abonado en
 * primavera, tratamientos en verano, cosecha en otoño) — anything older
 * than that is "long ago" from the daily-management perspective and
 * better viewed via the cuaderno screen. */
export const PARCELA_STATS_WINDOW_DAYS = 90;

/** A parcela is flagged "stale" when its most recent activity is older
 * than this. The dashboard surfaces this so a grower with 8 parcelas can
 * spot which ones haven't been touched in a while — a real concern when
 * tasks rotate seasonally and one plot can quietly get skipped. */
export const PARCELA_STALE_DAYS = 60;

export interface ParcelaStats {
  /** Total activities in the last PARCELA_STATS_WINDOW_DAYS window. */
  recentCount: number;
  /** Sum of costEur over the same window, treating null as 0. */
  recentCostEur: number;
  /** ISO date of the most recent activity within the window, or null. */
  lastActividadAt: string | null;
}

export interface ParcelasAggregate {
  totalParcelas: number;
  /** Sum of areaHa across parcelas with a known surface. Parcelas missing
   * areaHa are simply skipped — they shouldn't count as 0. The UI may want
   * to flag this gap separately, but the headline number stays honest. */
  totalAreaHa: number;
  /** How many parcelas had no areaHa recorded (nullable). Surfaced so the
   * UI can show "N de M sin superficie" instead of silently undercounting. */
  parcelasWithoutArea: number;
  totalRecentCount: number;
  totalRecentCostEur: number;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function fetchParcelaStats(
  parcelaId: string,
): Promise<ParcelaStats> {
  const from = isoDaysAgo(PARCELA_STATS_WINDOW_DAYS);
  const list = await actividadesService.list({ parcelaId, from });

  let recentCostEur = 0;
  for (const a of list) {
    if (a.costEur !== null) recentCostEur += a.costEur;
  }

  // Backend orders activities by performedAt desc, so the first item is
  // the latest within the window. If the window is empty, fall back to
  // null rather than fetching unbounded — the UI shows "—" / "stale" then.
  const lastActividadAt = list[0]?.performedAt ?? null;

  return {
    recentCount: list.length,
    recentCostEur,
    lastActividadAt,
  };
}

export function aggregateParcelas(
  parcelas: Parcela[],
  statsByParcela: Map<string, ParcelaStats>,
): ParcelasAggregate {
  let totalAreaHa = 0;
  let parcelasWithoutArea = 0;
  let totalRecentCount = 0;
  let totalRecentCostEur = 0;
  for (const p of parcelas) {
    if (p.areaHa !== null) totalAreaHa += p.areaHa;
    else parcelasWithoutArea += 1;
    const s = statsByParcela.get(p.id);
    if (!s) continue;
    totalRecentCount += s.recentCount;
    totalRecentCostEur += s.recentCostEur;
  }
  return {
    totalParcelas: parcelas.length,
    totalAreaHa,
    parcelasWithoutArea,
    totalRecentCount,
    totalRecentCostEur,
  };
}

/**
 * True when the parcela hasn't been touched in PARCELA_STALE_DAYS. The
 * stats fetch only looks back PARCELA_STATS_WINDOW_DAYS so we can decide
 * "stale" from the in-memory data: if the window is wider than the stale
 * threshold (currently 90 vs 60) and the most recent activity within the
 * window is older than the threshold, OR no activity at all in the window,
 * then it's stale. We deliberately don't fetch beyond the window to find
 * an older activity — past 90 days it's "stale" regardless.
 */
export function isParcelaStale(stats: ParcelaStats | null | undefined): boolean {
  if (!stats) return false; // unknown — don't false-flag while loading
  if (stats.lastActividadAt === null) return true;
  const cutoff = isoDaysAgo(PARCELA_STALE_DAYS);
  return stats.lastActividadAt < cutoff;
}
