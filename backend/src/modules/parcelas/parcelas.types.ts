import { z } from 'zod';
import { sigpacReferenceSchema, SigpacReference } from '../sigpac/sigpac.types';

// Loose GeoJSON Geometry — accepts any object with a type + coordinates.
// Can be tightened to a full GeoJSON union (Point/Polygon/MultiPolygon/…)
// once the app settles on which geometries it actually writes.
const geometrySchema = z
  .object({
    type: z.string(),
    coordinates: z.unknown(),
  })
  .passthrough();

export type GeoJsonGeometry = z.infer<typeof geometrySchema>;

export const parcelaIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listParcelasQuerySchema = z.object({
  fincaId: z.string().uuid(),
});
export type ListParcelasQuery = z.infer<typeof listParcelasQuerySchema>;

export const createParcelaSchema = z.object({
  fincaId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  areaHa: z.number().positive().optional(),
  sigpacRef: sigpacReferenceSchema.optional(),
  geometry: geometrySchema.optional(),
});
export type CreateParcelaInput = z.infer<typeof createParcelaSchema>;

export const createParcelaFromSigpacSchema = z
  .object({
    fincaId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    reference: sigpacReferenceSchema,
  })
  .strict();
export type CreateParcelaFromSigpacInput = z.infer<typeof createParcelaFromSigpacSchema>;

export const updateParcelaSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    areaHa: z.number().positive().nullable().optional(),
    sigpacRef: sigpacReferenceSchema.nullable().optional(),
    geometry: geometrySchema.nullable().optional(),
  })
  .strict();
export type UpdateParcelaInput = z.infer<typeof updateParcelaSchema>;

export interface ParcelaRow {
  id: string;
  finca_id: string;
  name: string;
  area_ha: string | number | null;
  sigpac_ref: SigpacReference | null;
  geometry: GeoJsonGeometry | null;
  created_at: string;
  updated_at: string;
}

export interface Parcela {
  id: string;
  fincaId: string;
  name: string;
  areaHa: number | null;
  sigpacRef: SigpacReference | null;
  geometry: GeoJsonGeometry | null;
  createdAt: string;
  updatedAt: string;
}
