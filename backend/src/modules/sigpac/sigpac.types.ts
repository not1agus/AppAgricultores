import { z } from 'zod';

/**
 * Reference fields are strings, not numbers, so leading zeros in the
 * Spanish cadastral codes (e.g. provincia "01") are preserved end-to-end.
 */
const numericString = z
  .string()
  .trim()
  .regex(/^\d+$/, 'Must contain digits only')
  .min(1);

export const sigpacReferenceSchema = z
  .object({
    provincia: numericString.max(2),
    municipio: numericString.max(3),
    agregado: numericString.max(3).optional(),
    zona: numericString.max(3).optional(),
    poligono: numericString.max(5),
    parcela: numericString.max(5),
    recinto: numericString.max(5).optional(),
  })
  .strict();
export type SigpacReference = z.infer<typeof sigpacReferenceSchema>;

export const lookupBodySchema = sigpacReferenceSchema;

export type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface SigpacParcelResult {
  reference: SigpacReference;
  areaHa: number | null;
  geometry: GeoJsonGeometry;
}
