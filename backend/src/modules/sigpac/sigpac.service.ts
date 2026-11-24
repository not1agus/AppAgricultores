import proj4 from 'proj4';
import { XMLParser } from 'fast-xml-parser';
import { env } from '../../config';
import { AppError, NotFoundError } from '../../common/errors';
import { logger } from '../../common/utils/logger';
import {
  GeoJsonGeometry,
  SigpacParcelResult,
  SigpacReference,
} from './sigpac.types';

// SIGPAC WFS devuelve siempre en EPSG:25830 (UTM Zona 30N, metros)
// aunque se solicite EPSG:4326 — definimos la proyección una vez aquí.
proj4.defs(
  'EPSG:25830',
  '+proj=utm +zone=30 +ellps=WGS84 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

const FEATURE_TYPE_NAME = 'sigpac:recinto';
const AREA_FIELD_CANDIDATES = ['dn_surface', 'superficie', 'area_ha', 'area'];
const HTTP_TIMEOUT_MS = 10_000;

class SigpacServiceError extends AppError {
  constructor(message: string, code = 'SIGPAC_SERVICE_ERROR') {
    super(message, 502, code);
  }
}

function buildCqlFilter(ref: SigpacReference): string {
  const parts = [
    `provincia=${ref.provincia}`,
    `municipio=${ref.municipio}`,
    `poligono=${ref.poligono}`,
    `parcela=${ref.parcela}`,
  ];
  if (ref.recinto !== undefined) {
    parts.push(`recinto=${ref.recinto}`);
  }
  return parts.join(' AND ');
}

function buildWfsUrl(ref: SigpacReference): string {
  if (!env.SIGPAC_WFS_URL) {
    throw new SigpacServiceError(
      'SIGPAC WFS endpoint is not configured',
      'SIGPAC_NOT_CONFIGURED',
    );
  }
  const url = new URL(env.SIGPAC_WFS_URL);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('typeNames', FEATURE_TYPE_NAME);
  url.searchParams.set('CQL_FILTER', buildCqlFilter(ref));
  url.searchParams.set('srsName', 'EPSG:4326');
  return url.toString();
}

async function fetchWfs(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/xml,text/xml' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new SigpacServiceError(`Upstream returned status ${res.status}`);
    }
    return await res.text();
  } catch (err) {
    if (err instanceof SigpacServiceError) throw err;
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

// ---------- XML / GML walking helpers ----------

type Hit = { key: string; value: unknown };

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function findAll(
  node: unknown,
  predicate: (key: string) => boolean,
  hits: Hit[] = [],
): Hit[] {
  if (!node || typeof node !== 'object') return hits;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (predicate(key)) hits.push({ key, value });
    if (Array.isArray(value)) {
      for (const item of value) findAll(item, predicate, hits);
    } else if (typeof value === 'object' && value !== null) {
      findAll(value, predicate, hits);
    }
  }
  return hits;
}

function readText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    if (typeof text === 'string') return text;
    if (typeof text === 'number') return String(text);
  }
  return null;
}

function parseCoordList(text: string): number[][] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const coords: number[][] = [];

  if (trimmed.includes(',')) {
    // GML 2 style: "x1,y1 x2,y2 …"
    for (const pair of trimmed.split(/\s+/)) {
      const [xs, ys] = pair.split(',');
      const x = Number(xs);
      const y = Number(ys);
      if (Number.isFinite(x) && Number.isFinite(y)) coords.push([x, y]);
    }
    return coords;
  }

  // GML 3 style: "x1 y1 x2 y2 …"
  const tokens = trimmed.split(/\s+/);
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const x = Number(tokens[i]);
    const y = Number(tokens[i + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) coords.push([x, y]);
  }
  return coords;
}

function ensureClosedRing(coords: number[][]): number[][] {
  if (coords.length < 3) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    return [...coords, first];
  }
  return coords;
}

function extractRingsFromPolygon(polygonNode: unknown): number[][][] {
  const rings: number[][][] = [];
  const ringHits = findAll(
    polygonNode,
    (k) => k === 'posList' || k === 'coordinates',
  );
  for (const { value } of ringHits) {
    const text = readText(value);
    if (!text) continue;
    const coords = parseCoordList(text);
    if (coords.length >= 3) rings.push(ensureClosedRing(coords));
  }
  return rings;
}

function extractGeometry(parsed: unknown): GeoJsonGeometry | null {
  const polygonHits = findAll(parsed, (k) => k === 'Polygon');
  const polygons: number[][][][] = [];

  for (const { value } of polygonHits) {
    for (const polygonInstance of asArray(value)) {
      const rings = extractRingsFromPolygon(polygonInstance);
      if (rings.length > 0) polygons.push(rings);
    }
  }

  if (polygons.length === 0) return null;

  const first = polygons[0];
  if (polygons.length === 1 && first) {
    return { type: 'Polygon', coordinates: first };
  }
  return { type: 'MultiPolygon', coordinates: polygons };
}

function extractAreaHa(parsed: unknown): number | null {
  const fieldSet = new Set(AREA_FIELD_CANDIDATES.map((f) => f.toLowerCase()));
  const hits = findAll(parsed, (k) => fieldSet.has(k.toLowerCase()));
  for (const hit of hits) {
    const text = readText(hit.value);
    if (text === null) continue;
    const num = Number(text);
    if (!Number.isFinite(num)) continue;
    // Heuristic: SIGPAC area fields are usually m². Convert to hectares.
    // If the field name contains "ha", treat as hectares directly.
    return /ha/i.test(hit.key) ? num : num / 10_000;
  }
  return null;
}

// ---------- UTM → WGS84 ----------

/**
 * El WFS de SIGPAC devuelve EPSG:25830 (UTM Zona 30N) aunque se pida
 * EPSG:4326. Las coordenadas UTM tienen valores en el rango de cientos de
 * miles / millones de metros — muy fuera del rango [-180,180] de WGS84 —
 * por eso son indetectables de inmediato y rompen Leaflet silenciosamente.
 *
 * Estrategia:
 *   - Si el primer punto tiene |valor| > 360 → es UTM, hay que convertir.
 *   - GML3 estándar para EPSG:25830 usa orden (Easting, Northing).
 *     Si el primer valor > 1 000 000 es Northing-first (algún servidor lo
 *     invierte) → intercambiamos ejes antes de proyectar.
 */
function utmToWgs84Ring(ring: number[][]): number[][] {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  if (Math.abs(first[0]!) <= 360 && Math.abs(first[1]!) <= 360) {
    return ring; // ya es WGS84
  }
  const swapAxes = first[0]! > 1_000_000; // Northing-first
  return ring.map(([a, b, ...rest]) => {
    if (a === undefined || b === undefined) return [a!, b!, ...rest];
    const [easting, northing] = swapAxes ? [b, a] : [a, b];
    const [lng, lat] = proj4('EPSG:25830', 'WGS84', [easting, northing]) as [number, number];
    return [lng, lat, ...rest];
  });
}

function convertGeometryToWgs84(geometry: GeoJsonGeometry): GeoJsonGeometry {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map(utmToWgs84Ring),
    };
  }
  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((poly) =>
      poly.map(utmToWgs84Ring),
    ),
  };
}

// ---------- Public API ----------

export const sigpacService = {
  async fetchByReference(reference: SigpacReference): Promise<SigpacParcelResult> {
    const url = buildWfsUrl(reference);
    const xml = await fetchWfs(url);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      trimValues: true,
    });

    let parsed: unknown;
    try {
      parsed = parser.parse(xml);
    } catch (err) {
      logger.warn('SIGPAC: failed to parse WFS XML', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new SigpacServiceError('Could not parse WFS response');
    }

    const rawGeometry = extractGeometry(parsed);
    if (!rawGeometry) {
      throw new NotFoundError(
        'No SIGPAC feature found for reference',
        'SIGPAC_NOT_FOUND',
      );
    }

    return {
      reference,
      areaHa: extractAreaHa(parsed),
      geometry: convertGeometryToWgs84(rawGeometry),
    };
  },
};
