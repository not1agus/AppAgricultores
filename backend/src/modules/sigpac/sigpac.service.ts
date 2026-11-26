import { AppError, NotFoundError } from '../../common/errors';
import {
  GeoJsonGeometry,
  SigpacParcelResult,
  SigpacReference,
} from './sigpac.types';

const HTTP_TIMEOUT_MS = 15_000;
const CSP_BASE = 'https://sigpac-hubcloud.es/servicioconsultassigpac/query';

class SigpacServiceError extends AppError {
  constructor(message: string, code = 'SIGPAC_SERVICE_ERROR') {
    super(message, 502, code);
  }
}

// /recinfoparc/{pr}/{mu}/{ag}/{zo}/{po}/{pa}.geojson — all recintos for a parcela
// /recinfo/{pr}/{mu}/{ag}/{zo}/{po}/{pa}/{re}.geojson  — single recinto
function buildUrl(ref: SigpacReference): string {
  const { provincia: pr, municipio: mu, poligono: po, parcela: pa } = ref;
  const ag = ref.agregado ?? '0';
  const zo = ref.zona ?? '0';
  if (ref.recinto !== undefined) {
    return `${CSP_BASE}/recinfo/${pr}/${mu}/${ag}/${zo}/${po}/${pa}/${ref.recinto}.geojson`;
  }
  return `${CSP_BASE}/recinfoparc/${pr}/${mu}/${ag}/${zo}/${po}/${pa}.geojson`;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new SigpacServiceError(`Upstream returned status ${res.status}`);
    }
    return await res.json() as unknown;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SigpacServiceError('Upstream request timed out', 'SIGPAC_TIMEOUT');
    }
    throw new SigpacServiceError(
      err instanceof Error ? err.message : 'Upstream request failed',
    );
  } finally {
    clearTimeout(timer);
  }
}

function extractGeometry(geojson: unknown): GeoJsonGeometry {
  const fc = geojson as Record<string, unknown>;

  if (fc['type'] === 'FeatureCollection') {
    const features = fc['features'] as Array<Record<string, unknown>>;
    if (!features?.length) {
      throw new NotFoundError('No SIGPAC feature found for reference', 'SIGPAC_NOT_FOUND');
    }
    // Merge multiple recintos into a MultiPolygon when there are several
    if (features.length === 1) {
      const geom = features[0]?.['geometry'] as GeoJsonGeometry | undefined;
      if (!geom) throw new SigpacServiceError('Feature has no geometry');
      return geom;
    }
    const polygons: number[][][][] = [];
    for (const feat of features) {
      const geom = feat['geometry'] as GeoJsonGeometry | undefined;
      if (!geom) continue;
      if (geom.type === 'Polygon') polygons.push(geom.coordinates);
      else if (geom.type === 'MultiPolygon') polygons.push(...geom.coordinates);
    }
    if (polygons.length === 0) throw new NotFoundError('No geometry in SIGPAC response', 'SIGPAC_NOT_FOUND');
    return { type: 'MultiPolygon', coordinates: polygons };
  }

  if (fc['type'] === 'Feature') {
    const geom = fc['geometry'] as GeoJsonGeometry | undefined;
    if (!geom) throw new SigpacServiceError('Feature has no geometry');
    return geom;
  }

  if (fc['type'] === 'Polygon' || fc['type'] === 'MultiPolygon') {
    return fc as unknown as GeoJsonGeometry;
  }

  throw new SigpacServiceError('Unexpected GeoJSON structure from SIGPAC');
}

function extractAreaHa(geojson: unknown): number | null {
  const fc = geojson as Record<string, unknown>;
  const features = fc['features'] as Array<Record<string, unknown>> | undefined;
  if (!features?.length) return null;

  let totalM2 = 0;
  let found = false;
  for (const feat of features) {
    const props = feat['properties'] as Record<string, unknown> | null;
    if (!props) continue;
    for (const key of ['dn_surface', 'superficie', 'area_ha', 'area']) {
      const val = props[key];
      if (val === undefined || val === null) continue;
      const num = Number(val);
      if (!Number.isFinite(num)) continue;
      totalM2 += /ha/i.test(key) ? num * 10_000 : num;
      found = true;
      break;
    }
  }
  return found ? totalM2 / 10_000 : null;
}

export const sigpacService = {
  async fetchByReference(reference: SigpacReference): Promise<SigpacParcelResult> {
    const url = buildUrl(reference);
    const data = await fetchJson(url);
    return {
      reference,
      areaHa: extractAreaHa(data),
      geometry: extractGeometry(data),
    };
  },
};
