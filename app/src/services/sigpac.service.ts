import { api } from '@/services/api';

/**
 * SIGPAC reference fields are kept as strings (not numbers) so leading zeros
 * in Spanish cadastral codes (e.g. provincia "01") survive the round-trip.
 * This mirrors the Zod schema in backend/src/modules/sigpac/sigpac.types.ts.
 */
export interface SigpacReference {
  provincia: string;
  municipio: string;
  agregado?: string;
  zona?: string;
  poligono: string;
  parcela: string;
  recinto?: string;
}

export type SigpacGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface SigpacParcelResult {
  reference: SigpacReference;
  areaHa: number | null;
  geometry: SigpacGeometry;
}

export const sigpacService = {
  lookup(reference: SigpacReference): Promise<SigpacParcelResult> {
    return api.post<SigpacParcelResult>('/sigpac/lookup', reference);
  },
};
