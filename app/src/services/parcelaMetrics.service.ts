import {
  ACTIVIDAD_TYPE_LABELS,
  Actividad,
  ActividadType,
} from '@/services/actividades.service';

// Cost-per-hectare metrics derived from the activity log
// ----------------------------------------------------------------------------
// We already capture `costEur` on each actividad — this module reshapes
// that data into the question a grower actually asks: "what am I spending
// per hectare on this parcela, and on what?"
//
// Everything here is pure derivation. The screen passes in the activities
// and parcela it already has loaded; we never touch the network. That
// keeps the metrics card free to re-render in response to any state shift
// (date filter, edit, refresh) without re-paying a round-trip.
//
// Notes on accounting:
//   * `costEur === null` rows are EXCLUDED from totals. Null means "not
//     recorded" — silently treating it as 0 would understate the average
//     and bury the data quality problem.
//   * Labour without an explicit cost (poda hecha por el dueño) is also
//     null. That's the right behaviour: don't impute.
//   * `areaHa === null` means we can show absolute totals but not a per-ha
//     ratio. The UI surfaces a hint in that case.

export interface TypeBreakdownEntry {
  type: ActividadType;
  label: string;
  totalCostEur: number;
  count: number;
  /** Share of total cost, in 0..1. Computed against the rows that have a
   * cost (so all entries here sum to ≤ 1.0). */
  share: number;
}

export interface ParcelaMetrics {
  /** Number of activities considered (all of them, including null-cost). */
  activityCount: number;
  /** Number of activities with a non-null cost — the denominator behind
   * the totals. Equal to `activityCount` only when every row has a cost. */
  activityCountWithCost: number;
  /** Sum of all non-null `costEur` in the input window, in euros. */
  totalCostEur: number;
  /** `totalCostEur / parcela.areaHa` when area is known; null otherwise. */
  costEurPerHa: number | null;
  /** Same total but restricted to fitosanitario activities. Useful because
   * tratamientos tend to be a meaningful and variable cost component. */
  fitosanitarioCostEur: number;
  /** Number of fitosanitario applications in the window. */
  fitosanitarioCount: number;
  /** Top-N type breakdown by total cost desc. Always includes every type
   * that has at least one cost row in the window. */
  byType: TypeBreakdownEntry[];
}

export interface ComputeMetricsOpts {
  /** ISO YYYY-MM-DD inclusive lower bound. Activities with
   * `performedAt < from` are excluded. Default: no lower bound. */
  fromIso?: string;
  /** ISO YYYY-MM-DD inclusive upper bound. Default: no upper bound. */
  toIso?: string;
}

/** Pure: derive the metrics for a parcela from its activity log.
 *
 * The window filter is applied in JS — the screen already has the full
 * list in memory and re-deriving on a date toggle is cheap. */
export function computeParcelaMetrics(
  areaHa: number | null,
  activities: Actividad[],
  opts: ComputeMetricsOpts = {},
): ParcelaMetrics {
  const filtered = activities.filter((a) => {
    if (opts.fromIso && a.performedAt < opts.fromIso) return false;
    if (opts.toIso && a.performedAt > opts.toIso) return false;
    return true;
  });

  let totalCostEur = 0;
  let activityCountWithCost = 0;
  let fitosanitarioCostEur = 0;
  let fitosanitarioCount = 0;
  // We accumulate per-type totals in a Map and only project to the
  // breakdown array at the end — saves one pass.
  const typeTotals = new Map<ActividadType, { sum: number; n: number }>();

  for (const a of filtered) {
    if (a.type === 'tratamiento_fitosanitario') {
      fitosanitarioCount++;
    }
    if (a.costEur === null) continue;
    totalCostEur += a.costEur;
    activityCountWithCost++;
    if (a.type === 'tratamiento_fitosanitario') {
      fitosanitarioCostEur += a.costEur;
    }
    const slot = typeTotals.get(a.type);
    if (slot) {
      slot.sum += a.costEur;
      slot.n++;
    } else {
      typeTotals.set(a.type, { sum: a.costEur, n: 1 });
    }
  }

  const byType: TypeBreakdownEntry[] = Array.from(typeTotals.entries())
    .map(([type, { sum, n }]) => ({
      type,
      label: ACTIVIDAD_TYPE_LABELS[type],
      totalCostEur: sum,
      count: n,
      share: totalCostEur > 0 ? sum / totalCostEur : 0,
    }))
    .sort((a, b) => b.totalCostEur - a.totalCostEur);

  // Guard against zero/negative areaHa. A parcela with areaHa===0 is a
  // data-entry mistake but shouldn't crash the screen.
  const costEurPerHa =
    areaHa !== null && areaHa > 0 ? totalCostEur / areaHa : null;

  return {
    activityCount: filtered.length,
    activityCountWithCost,
    totalCostEur,
    costEurPerHa,
    fitosanitarioCostEur,
    fitosanitarioCount,
    byType,
  };
}

/** ISO YYYY-MM-DD for `daysAgo` days before today, in local time. Mirrors
 * the helper used in ParcelaDetailScreen so windowing is consistent. */
export function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
