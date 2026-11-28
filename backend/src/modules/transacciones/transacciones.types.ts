import { z } from 'zod';

export const transaccionKindSchema = z.enum(['ingreso', 'gasto']);
export type TransaccionKind = z.infer<typeof transaccionKindSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO date (YYYY-MM-DD)');

const categorySchema = z.string().trim().min(1).max(80);

export const transaccionIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listTransaccionesQuerySchema = z
  .object({
    campanaId: z.string().uuid().optional(),
    fincaId: z.string().uuid().optional(),
    kind: transaccionKindSchema.optional(),
    category: categorySchema.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((v) => v.campanaId !== undefined || v.fincaId !== undefined, {
    message: 'Either campanaId or fincaId is required',
    path: ['campanaId'],
  });
export type ListTransaccionesQuery = z.infer<typeof listTransaccionesQuerySchema>;

export const createTransaccionSchema = z
  .object({
    campanaId: z.string().uuid(),
    kind: transaccionKindSchema,
    category: categorySchema,
    occurredAt: isoDate,
    amountEur: z.number().nonnegative(),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();
export type CreateTransaccionInput = z.infer<typeof createTransaccionSchema>;

export const updateTransaccionSchema = z
  .object({
    kind: transaccionKindSchema.optional(),
    category: categorySchema.optional(),
    occurredAt: isoDate.optional(),
    amountEur: z.number().nonnegative().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type UpdateTransaccionInput = z.infer<typeof updateTransaccionSchema>;

export interface TransaccionRow {
  id: string;
  campana_id: string;
  kind: TransaccionKind;
  category: string;
  occurred_at: string;
  amount_eur: string | number;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Transaccion {
  id: string;
  campanaId: string;
  kind: TransaccionKind;
  category: string;
  occurredAt: string;
  amountEur: number;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampanaSummary {
  campanaId: string;
  totalIngresos: number;
  totalGastos: number;
  balance: number;
  count: number;
}
