import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO date (YYYY-MM-DD)');

const nameSchema = z.string().trim().min(1).max(120);

export const campanaIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listCampanasQuerySchema = z.object({
  fincaId: z.string().uuid(),
});
export type ListCampanasQuery = z.infer<typeof listCampanasQuerySchema>;

// endDate is optional: a campaign is typically created when it starts, so
// the grower can't yet know when it'll close. It can be filled in later.
export const createCampanaSchema = z
  .object({
    fincaId: z.string().uuid(),
    name: nameSchema,
    startDate: isoDate,
    endDate: isoDate.optional(),
  })
  .strict()
  .refine((v) => v.endDate === undefined || v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });
export type CreateCampanaInput = z.infer<typeof createCampanaSchema>;

export const updateCampanaSchema = z
  .object({
    name: nameSchema.optional(),
    startDate: isoDate.optional(),
    // nullable so the caller can reopen a campaign by clearing its end.
    endDate: isoDate.nullable().optional(),
  })
  .strict();
export type UpdateCampanaInput = z.infer<typeof updateCampanaSchema>;

export interface CampanaRow {
  id: string;
  finca_id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campana {
  id: string;
  fincaId: string;
  name: string;
  startDate: string;
  /** null when the campaign is still open (no end date set yet). */
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}
