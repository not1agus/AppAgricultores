import { z } from 'zod';

export const fincaIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createFincaSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type CreateFincaInput = z.infer<typeof createFincaSchema>;

export const updateFincaSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type UpdateFincaInput = z.infer<typeof updateFincaSchema>;

export type MemberRole = 'owner' | 'worker';

export interface FincaRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Finca {
  id: string;
  ownerId: string;
  name: string;
  /** The calling user's role in this finca. */
  role: MemberRole;
  createdAt: string;
  updatedAt: string;
}
