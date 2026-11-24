import {
  actividadesService,
  ActividadType,
} from '@/services/actividades.service';
import { Finca } from '@/services/fincas.service';
import { Parcela, parcelasService } from '@/services/parcelas.service';
import { PARCELA_STALE_DAYS } from '@/services/parcelaStats.service';
import { Ticket, ticketsService } from '@/services/tickets.service';

/**
 * Lightweight per-finca stats shown on the home dashboard.
 *
 * NOTE on cost: this is currently 3 list endpoints per finca (parcelas,
 * actividades within the stale window, tickets) so a user with N fincas pays
 * 3N round trips on home load. Acceptable for the typical 1-3 fincas per
 * user; if average grows, replace with a single backend `/dashboard`
 * aggregator endpoint.
 *
 * The actividades window is the longer of two needs: 30d feeds the
 * "Actividades 30d" headline, 60d (PARCELA_STALE_DAYS) feeds the stale-
 * parcela detection. We fetch once at the wider window and derive both in
 * memory rather than hitting the wire twice.
 */
/** Cap on per-finca pending tickets we surface to the home dashboard. The
 * home only renders the top 3 across ALL fincas, so even with 5 fincas we
 * over-fetch by at most 12 rows worth of references — negligible vs the
 * cost of hitting the wire again. */
const PENDING_TICKETS_PER_FINCA = 3;

/** Same logic as PENDING_TICKETS_PER_FINCA but for stale parcelas: the
 * cross-finca cap on the home is small, so over-fetching slightly per finca
 * is cheaper than a follow-up call. */
const STALE_PARCELAS_PER_FINCA = 3;

/** Per-finca cap on the recent-activity preview shipped to the home feed.
 * The home shows up to ~3 across ALL fincas, so even with 5 fincas we
 * over-fetch by at most ~25 rows worth of references — well within the
 * 60d activity payload that's already in memory. */
const RECENT_ACTIVIDADES_PER_FINCA = 5;

/** Window for the headline "Actividades 30d" metric. Kept distinct from the
 * stale window because the meanings differ — 30d is "what have I done
 * lately?", 60d is "what have I forgotten?". */
const RECENT_ACTIVIDADES_WINDOW_DAYS = 30;

/** Lightweight per-parcela record for the home dashboard's stale section.
 * We keep this minimal (no areaHa, no SIGPAC) because the home row only
 * shows name + finca name + age — anything richer is one tap away in
 * ParcelaDetail. */
export interface StaleParcela {
  id: string;
  fincaId: string;
  name: string;
  /** ISO date of the parcela's most recent activity within the stale
   * window, or null if no activity at all in the window. Drives the
   * "hace N días" label. */
  lastActividadAt: string | null;
}

/** Denormalized activity row for the home recent-activity feed. We attach
 * `parcelaName` here (resolved at fetch-time from the per-finca parcelas
 * list, which is already in memory) so the home doesn't have to thread a
 * second map through the cross-finca aggregation. `fincaName` is NOT
 * attached: the home already maintains a fincaId→name lookup for the
 * pending-tickets section, so reusing that one map keeps a single source
 * of truth for finca display names. */
export interface RecentActividadEntry {
  id: string;
  fincaId: string;
  parcelaId: string;
  parcelaName: string;
  type: ActividadType;
  performedAt: string;
  costEur: number | null;
}

export interface FincaStats {
  parcelasCount: number;
  /** Activities in the last 30 days (rolling window). */
  recentActividadesCount: number;
  /** Subset of `recentActividadesCount` that have zero photos attached.
   * Scoped to the same 30d window because photo backfill is only useful
   * while the user still remembers the work — chasing a photo for an
   * activity from last summer is rarely worth the effort. */
  recentActividadesSinFotoCount: number;
  /** Tickets that are not done yet (pending OCR or manual review). */
  pendingTicketsCount: number;
  /** ISO date of the most recent activity, or null if none. */
  lastActividadAt: string | null;
  /** Up to PENDING_TICKETS_PER_FINCA oldest non-done tickets, oldest first. */
  pendingTickets: Ticket[];
  /** Total parcelas in this finca that count as stale per the dashboard
   * heuristic (no activity in the stale window AND created more than the
   * stale window ago — a freshly-created parcela isn't "abandoned"). */
  staleParcelasCount: number;
  /** Up to STALE_PARCELAS_PER_FINCA stalest parcelas (null lastActividadAt
   * first, then oldest performedAt). Cross-finca aggregation re-sorts. */
  staleParcelas: StaleParcela[];
  /** Up to RECENT_ACTIVIDADES_PER_FINCA most recent activities (any type)
   * within the 60d window, denormalized with parcela names. The home merges
   * these across fincas to render the global feed. */
  recentActividades: RecentActividadEntry[];
}

export interface DashboardAggregate {
  totalFincas: number;
  totalParcelas: number;
  totalRecentActividades: number;
  totalRecentActividadesSinFoto: number;
  totalPendingTickets: number;
  totalStaleParcelas: number;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function fetchFincaStats(fincaId: string): Promise<FincaStats> {
  // Fetch the wider window (stale = 60d) and derive the narrower 30d
  // headline from it in memory. Cheaper than two round-trips, and the
  // payload growth is bounded by activities-per-month which stays small
  // for the typical olivar.
  const fromStale = isoDaysAgo(PARCELA_STALE_DAYS);
  const recentCutoff = isoDaysAgo(RECENT_ACTIVIDADES_WINDOW_DAYS);
  const [parcelas, actividades, tickets] = await Promise.all([
    parcelasService.listByFinca(fincaId),
    actividadesService.list({ fincaId, from: fromStale }),
    ticketsService.listByFinca(fincaId),
  ]);

  // Tickets backend returns the lot — the "pending" filter is purely a
  // bucketing aid for the dashboard, not a security boundary.
  const pendingAll = tickets.filter((t) => t.status !== 'done');
  // Oldest first: the user's pain point is "I uploaded a ticket and forgot
  // about it" — surfacing the most stale ones is more actionable than the
  // newest. createdAt is ISO so a lexicographic sort works.
  const pendingSorted = [...pendingAll].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );

  // 30d slice for the headline metric — derived in memory from the 60d
  // window so we don't pay for two queries.
  const recentActividades = actividades.filter(
    (a) => a.performedAt >= recentCutoff,
  );

  // actividadesService.list already orders by performedAt desc on the backend
  // (see actividades.service ordering); the first item is the latest within
  // the 60-day window. If empty, fall back to null rather than re-querying
  // unbounded — the dashboard cell renders "—" in that case.
  const lastActividadAt = actividades[0]?.performedAt ?? null;

  // Photo coverage is a soft KPI for the cuaderno digital: an activity
  // without a photo is still a valid record, just less defensible in an
  // audit. Counted here (not separately fetched) because the 30d list is
  // already in memory.
  const sinFoto = recentActividades.filter((a) => a.photos.length === 0).length;

  // Per-parcela latest-touch within the 60d window. Built from the same
  // actividades list — backend already sorts by performedAt desc, so the
  // first time we see a parcelaId is its latest entry within the window.
  const latestByParcela = new Map<string, string>();
  for (const a of actividades) {
    if (!latestByParcela.has(a.parcelaId)) {
      latestByParcela.set(a.parcelaId, a.performedAt);
    }
  }

  const stale = computeStaleParcelas(fincaId, parcelas, latestByParcela);

  // Denormalize the most recent activities with parcela names for the
  // home feed. Backend already orders desc by performedAt; we just pick
  // the head and attach the name. Unknown parcela (e.g. RLS race or a
  // race with parcela deletion) falls back to a generic label rather
  // than dropping the row — the activity itself is still real.
  const parcelaNameById = new Map<string, string>();
  for (const p of parcelas) parcelaNameById.set(p.id, p.name);
  const recentEntries: RecentActividadEntry[] = actividades
    .slice(0, RECENT_ACTIVIDADES_PER_FINCA)
    .map((a) => ({
      id: a.id,
      fincaId,
      parcelaId: a.parcelaId,
      parcelaName: parcelaNameById.get(a.parcelaId) ?? 'Parcela',
      type: a.type,
      performedAt: a.performedAt,
      costEur: a.costEur,
    }));

  return {
    parcelasCount: parcelas.length,
    recentActividadesCount: recentActividades.length,
    recentActividadesSinFotoCount: sinFoto,
    pendingTicketsCount: pendingAll.length,
    lastActividadAt,
    pendingTickets: pendingSorted.slice(0, PENDING_TICKETS_PER_FINCA),
    staleParcelasCount: stale.total,
    staleParcelas: stale.top,
    recentActividades: recentEntries,
  };
}

/**
 * A parcela is "stale on the home" when it has zero activities in the
 * 60d window AND it was created more than 60 days ago. The createdAt
 * guard avoids flagging just-onboarded parcelas as abandoned — a freshly
 * registered SIGPAC parcela has no history yet but isn't a problem.
 *
 * Returns the full count plus the top STALE_PARCELAS_PER_FINCA for the
 * mini-list (cross-finca aggregation re-sorts and re-trims).
 */
function computeStaleParcelas(
  fincaId: string,
  parcelas: Parcela[],
  latestByParcela: Map<string, string>,
): { total: number; top: StaleParcela[] } {
  const cutoff = isoDaysAgo(PARCELA_STALE_DAYS);
  const stale: StaleParcela[] = [];
  for (const p of parcelas) {
    const lastSeen = latestByParcela.get(p.id) ?? null;
    if (lastSeen !== null) continue; // touched within window — not stale
    if (p.createdAt > cutoff) continue; // too new to count as forgotten
    stale.push({
      id: p.id,
      fincaId,
      name: p.name,
      lastActividadAt: null,
    });
  }
  // All current entries have lastActividadAt === null by construction;
  // we still keep the field on the interface so a future heuristic that
  // includes "touched once 50d ago" could populate it without an API change.
  // Sort by name for stable cross-finca ordering when many tie at "null".
  stale.sort((a, b) =>
    a.name.localeCompare(b.name, 'es') ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return { total: stale.length, top: stale.slice(0, STALE_PARCELAS_PER_FINCA) };
}

/**
 * Cross-finca aggregation of pending tickets for the home "atención"
 * surface. Keeps the oldest N regardless of which finca they belong to —
 * the user's mental model is "what's pending across my whole operation",
 * not "show me one per finca".
 */
export function collectPendingTickets(
  statsByFinca: Map<string, FincaStats>,
  limit: number,
): Ticket[] {
  const all: Ticket[] = [];
  for (const s of statsByFinca.values()) {
    for (const t of s.pendingTickets) all.push(t);
  }
  all.sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
  return all.slice(0, limit);
}

export function aggregateStats(
  fincas: Finca[],
  statsByFinca: Map<string, FincaStats>,
): DashboardAggregate {
  let totalParcelas = 0;
  let totalRecentActividades = 0;
  let totalRecentActividadesSinFoto = 0;
  let totalPendingTickets = 0;
  let totalStaleParcelas = 0;
  for (const f of fincas) {
    const s = statsByFinca.get(f.id);
    if (!s) continue;
    totalParcelas += s.parcelasCount;
    totalRecentActividades += s.recentActividadesCount;
    totalRecentActividadesSinFoto += s.recentActividadesSinFotoCount;
    totalPendingTickets += s.pendingTicketsCount;
    totalStaleParcelas += s.staleParcelasCount;
  }
  return {
    totalFincas: fincas.length,
    totalParcelas,
    totalRecentActividades,
    totalRecentActividadesSinFoto,
    totalPendingTickets,
    totalStaleParcelas,
  };
}

/**
 * Cross-finca aggregation of recent activities for the home feed. Each
 * per-finca slice is already trimmed to RECENT_ACTIVIDADES_PER_FINCA at
 * fetch time so the bag we sort here stays small (typical N×5 across a
 * handful of fincas). Sort: performedAt desc, id tiebreak. Unlike the
 * stale/pending sections this is informational, not actionable — kept
 * sober (no red, no badge) so it doesn't compete for attention with the
 * alert sections above it.
 */
export function collectRecentActividades(
  statsByFinca: Map<string, FincaStats>,
  limit: number,
): RecentActividadEntry[] {
  const all: RecentActividadEntry[] = [];
  for (const s of statsByFinca.values()) {
    for (const a of s.recentActividades) all.push(a);
  }
  all.sort((a, b) => {
    if (a.performedAt > b.performedAt) return -1;
    if (a.performedAt < b.performedAt) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return all.slice(0, limit);
}

/**
 * Cross-finca aggregation of stale parcelas for the home "atención"
 * surface. Mirrors collectPendingTickets — the user's mental model is
 * "what across my whole operation needs attention", not partitioned by
 * finca. Sort: parcelas with null lastActividadAt first (genuinely
 * never-touched), then by performedAt asc (least recently touched first).
 */
export function collectStaleParcelas(
  statsByFinca: Map<string, FincaStats>,
  limit: number,
): StaleParcela[] {
  const all: StaleParcela[] = [];
  for (const s of statsByFinca.values()) {
    for (const p of s.staleParcelas) all.push(p);
  }
  all.sort((a, b) => {
    const aN = a.lastActividadAt;
    const bN = b.lastActividadAt;
    if (aN === null && bN !== null) return -1;
    if (aN !== null && bN === null) return 1;
    if (aN !== null && bN !== null) {
      if (aN < bN) return -1;
      if (aN > bN) return 1;
    }
    // Final tiebreak by name then id so the order is deterministic
    // across renders.
    const byName = a.name.localeCompare(b.name, 'es');
    if (byName !== 0) return byName;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return all.slice(0, limit);
}
