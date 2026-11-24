import {
  Actividad,
  actividadesService,
} from '@/services/actividades.service';

// Plazo de seguridad / Pre-Harvest Interval (PHI)
// ----------------------------------------------------------------------------
// RD 1311/2012, art. 41: tras aplicar un fitosanitario no puede recolectarse
// hasta que transcurra el "plazo de seguridad" indicado en la etiqueta del
// producto. Capturamos `plazoSeguridadDias` en cada tratamiento; este módulo
// lo convierte en un estado accionable por parcela.
//
// La regla operativa es simple:
//   expiraEl = performedAt + plazoSeguridadDias
//   si hoy < expiraEl  -> activo (no recolectar)
//   si hoy >= expiraEl -> apto
//
// Tomamos el tratamiento que produce la fecha de expiración MÁS LEJANA, no
// el más reciente. Si hace 3 días aplicas un producto con plazo 21d y hoy
// otro con plazo 7d, manda el primero — el cosecha bloqueada hasta que
// venza el de mayor expiración.

export interface PlazoStatus {
  /** ISO date (YYYY-MM-DD) en que vence el plazo y la parcela vuelve a ser
   * apta para recolectar. */
  expiraEl: string;
  /** Días que faltan hasta `expiraEl`. Negativo si ya expiró (apto). */
  diasRestantes: number;
  /** True si hoy < expiraEl (no recolectar). */
  activo: boolean;
  /** Producto comercial del tratamiento que impone el plazo más largo —
   * útil para mostrar contexto en el banner ("debido a Cobre Nordox..."). */
  productoComercial: string;
  /** Fecha del tratamiento que impone el plazo. */
  performedAt: string;
  /** Id de esa actividad para enlace directo desde el banner. */
  actividadId: string;
}

/** Today as ISO YYYY-MM-DD, in local time. We compare ISO dates as strings —
 * works because `performedAt` is stored as YYYY-MM-DD too. */
function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Add `days` to an ISO YYYY-MM-DD date and return the result, again as ISO.
 * Uses UTC arithmetic to dodge DST jumps that would otherwise shift the
 * day for users on a clock-changing timezone. */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map((s) => Number.parseInt(s, 10));
  const utc = Date.UTC(y!, m! - 1, d!) + days * 24 * 60 * 60 * 1000;
  const r = new Date(utc);
  const yyyy = r.getUTCFullYear();
  const mm = String(r.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(r.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Days between two ISO YYYY-MM-DD dates (b - a). Positive if b is later. */
function diffDaysIso(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map((s) => Number.parseInt(s, 10));
  const [by, bm, bd] = b.split('-').map((s) => Number.parseInt(s, 10));
  const utcA = Date.UTC(ay!, am! - 1, ad!);
  const utcB = Date.UTC(by!, bm! - 1, bd!);
  return Math.round((utcB - utcA) / (24 * 60 * 60 * 1000));
}

/** Compute the plazo status for a single fitosanitario actividad. Returns
 * null for non-fitosanitario rows (the caller can pass a mixed list and
 * filter via the null). */
export function computePlazoFromActividad(a: Actividad): PlazoStatus | null {
  if (a.type !== 'tratamiento_fitosanitario' || !a.fitosanitario) return null;
  const plazoDias = a.fitosanitario.plazoSeguridadDias;
  const expiraEl = addDaysIso(a.performedAt, plazoDias);
  const today = todayIso();
  const diasRestantes = diffDaysIso(today, expiraEl);
  return {
    expiraEl,
    diasRestantes,
    activo: today < expiraEl,
    productoComercial: a.fitosanitario.productoComercial,
    performedAt: a.performedAt,
    actividadId: a.id,
  };
}

/** Pick the strictest plazo from a list of activities (the one whose
 * expiraEl is the farthest in the future). Returns null if none of the
 * activities is a fitosanitario or all have already expired. */
export function strictestActivePlazo(
  list: Actividad[],
): PlazoStatus | null {
  let winner: PlazoStatus | null = null;
  for (const a of list) {
    const s = computePlazoFromActividad(a);
    if (!s || !s.activo) continue;
    if (!winner || s.expiraEl > winner.expiraEl) winner = s;
  }
  return winner;
}

/** Group activities by parcela, then run `strictestActivePlazo` on each
 * group. Used by the finca hub to show "N parcelas con plazo activo". */
export function activePlazosByParcela(
  list: Actividad[],
): Map<string, PlazoStatus> {
  const byParcela = new Map<string, Actividad[]>();
  for (const a of list) {
    const arr = byParcela.get(a.parcelaId);
    if (arr) arr.push(a);
    else byParcela.set(a.parcelaId, [a]);
  }
  const out = new Map<string, PlazoStatus>();
  for (const [parcelaId, acts] of byParcela.entries()) {
    const s = strictestActivePlazo(acts);
    if (s) out.set(parcelaId, s);
  }
  return out;
}

/** Convenience: load the strictest active plazo for a single parcela.
 *
 * We pull only fitosanitario activities to keep the response slim. The
 * server-side `type` filter is already supported by the list endpoint.
 *
 * Note: there's no `since` cutoff here on purpose — even an old tratamiento
 * could still impose a plazo if it had a long PHI. The list is bounded
 * naturally because no realistic olivar will have hundreds of fitosanitario
 * applications. If that ever changes we can filter to e.g. last 90 days
 * (any reasonable PHI fits in that window). */
export async function loadActivePlazoForParcela(
  parcelaId: string,
): Promise<PlazoStatus | null> {
  const list = await actividadesService.list({
    parcelaId,
    type: 'tratamiento_fitosanitario',
  });
  return strictestActivePlazo(list);
}

/** Convenience: load the active-plazo map for an entire finca. Used by
 * the finca hub aggregation badge. */
export async function loadActivePlazosForFinca(
  fincaId: string,
): Promise<Map<string, PlazoStatus>> {
  const list = await actividadesService.list({
    fincaId,
    type: 'tratamiento_fitosanitario',
  });
  return activePlazosByParcela(list);
}

/** Format helper for UI — returns Spanish "DD/MM/YYYY". Kept here so all
 * plazo-related strings stay consistent across screens. */
export function formatPlazoDateEs(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
