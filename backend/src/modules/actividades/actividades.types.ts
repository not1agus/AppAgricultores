import { z } from 'zod';

export const actividadTypeSchema = z.enum([
  'tratamiento_fitosanitario',
  'riego',
  'poda',
  'cosecha',
  'abonado',
  'siembra',
  'laboreo',
  'otro',
]);
export type ActividadType = z.infer<typeof actividadTypeSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO date (YYYY-MM-DD)');

const photosArray = z.array(z.string().url()).max(20);

// --- Cuaderno fitosanitario (RD 1311/2012) -----------------------------------
export const fitosanitarioDosisUnitSchema = z.enum([
  'kg/ha',
  'L/ha',
  'kg/hL',
  'L/hL',
  '%',
]);
export type FitosanitarioDosisUnit = z.infer<
  typeof fitosanitarioDosisUnitSchema
>;

export const FITOSANITARIO_DOSIS_UNITS: FitosanitarioDosisUnit[] = [
  'kg/ha',
  'L/ha',
  'kg/hL',
  'L/hL',
  '%',
];

export const cantidadUnidadSchema = z.enum(['kg', 'L']);
export type CantidadUnidad = z.infer<typeof cantidadUnidadSchema>;

// DNI (8 dígitos + letra), NIE (X/Y/Z + 7 dígitos + letra) o CIF (letra + 7
// dígitos + dígito/letra). Solo formato: la letra de control no se calcula.
export const NIF_RE = /^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z]|[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J])$/;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalNif = z
  .string()
  .trim()
  .toUpperCase()
  .regex(NIF_RE, 'NIF/NIE/CIF con formato inválido')
  .nullable()
  .optional();

// Campos del Cuaderno Digital de Explotación (RD 1311/2012 Anexo III Parte
// I.B; Orden APA/204/2023 Anexo II.3) son opcionales al guardar para no
// invalidar registros antiguos ni obligar a conocer la eficacia el mismo día:
// la exportación CDE es quien exige que estén completos.
export const fitosanitarioSchema = z
  .object({
    productoComercial: z.string().trim().min(1).max(200),
    numeroRegistro: z.string().trim().min(1).max(50),
    materiaActiva: optionalText(200),
    dosis: z.number().positive(),
    dosisUnidad: fitosanitarioDosisUnitSchema,
    plagaObjetivo: z.string().trim().min(1).max(200),
    plazoSeguridadDias: z.number().int().min(0).max(365),
    volumenCaldoLHa: z.number().positive().nullable().optional(),
    operadorNombre: optionalText(200),
    operadorCarnet: optionalText(50),
    cultivoEspecie: optionalText(120),
    cultivoVariedad: optionalText(120),
    superficieTratadaHa: z.number().positive().max(100000).nullable().optional(),
    justificacion: optionalText(500),
    cantidadProducto: z.number().positive().max(1000000).nullable().optional(),
    cantidadUnidad: cantidadUnidadSchema.nullable().optional(),
    operadorNif: optionalNif,
    operadorRopo: optionalText(50),
    equipoDescripcion: optionalText(200),
    equipoRoma: optionalText(50),
    eficacia: optionalText(500),
    asesorNombre: optionalText(200),
    asesorNif: optionalNif,
    asesorRopo: optionalText(50),
    asesorFechaValidacion: isoDate.nullable().optional(),
  })
  .strict()
  .refine(
    (f) => (f.cantidadProducto == null) === (f.cantidadUnidad == null),
    {
      message: 'La cantidad de producto y su unidad van juntas',
      path: ['cantidadUnidad'],
    },
  );
export type Fitosanitario = z.infer<typeof fitosanitarioSchema>;

export const actividadIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listActividadesQuerySchema = z
  .object({
    parcelaId: z.string().uuid().optional(),
    fincaId: z.string().uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    type: actividadTypeSchema.optional(),
  })
  .refine((v) => v.parcelaId !== undefined || v.fincaId !== undefined, {
    message: 'Either parcelaId or fincaId is required',
    path: ['parcelaId'],
  });
export type ListActividadesQuery = z.infer<typeof listActividadesQuerySchema>;

export const createActividadSchema = z
  .object({
    parcelaId: z.string().uuid(),
    type: actividadTypeSchema,
    performedAt: isoDate,
    description: z.string().trim().max(2000).optional(),
    costEur: z.number().nonnegative().optional(),
    photos: photosArray.default([]),
    fitosanitario: fitosanitarioSchema.optional(),
    // Optional link to a campaña. The service verifies it belongs to the
    // same finca as the parcela.
    campanaId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.fitosanitario === undefined || v.type === 'tratamiento_fitosanitario',
    {
      message:
        'fitosanitario solo se acepta cuando type = tratamiento_fitosanitario',
      path: ['fitosanitario'],
    },
  );
export type CreateActividadInput = z.infer<typeof createActividadSchema>;

export const updateActividadSchema = z
  .object({
    type: actividadTypeSchema.optional(),
    performedAt: isoDate.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    costEur: z.number().nonnegative().nullable().optional(),
    photos: photosArray.optional(),
    // null clears the fitosanitario block (e.g. user changed type away from
    // tratamiento_fitosanitario). The service-level cross-field check makes
    // sure the resulting (type, fitosanitario) pair stays consistent — zod
    // can't see the existing row.
    fitosanitario: fitosanitarioSchema.nullable().optional(),
    // null unlinks the campaña; a uuid links/relinks it.
    campanaId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type UpdateActividadInput = z.infer<typeof updateActividadSchema>;

export interface ActividadRow {
  id: string;
  parcela_id: string;
  type: ActividadType;
  performed_at: string;
  description: string | null;
  cost_eur: string | number | null;
  photos: string[] | null;
  fitosanitario: Fitosanitario | null;
  campana_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Actividad {
  id: string;
  parcelaId: string;
  type: ActividadType;
  performedAt: string;
  description: string | null;
  costEur: number | null;
  photos: string[];
  fitosanitario: Fitosanitario | null;
  /** Optional campaña this activity belongs to. null = not tagged. */
  campanaId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
