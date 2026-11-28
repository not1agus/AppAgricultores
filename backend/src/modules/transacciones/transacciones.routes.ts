import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, validate } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { transaccionesController } from './transacciones.controller';
import {
  createTransaccionSchema,
  listTransaccionesQuerySchema,
  transaccionIdParamsSchema,
  updateTransaccionSchema,
} from './transacciones.types';

const summaryParamsSchema = z.object({
  campanaId: z.string().uuid(),
});

export const transaccionesRoutes: Router = Router();

transaccionesRoutes.use(requireAuth);

transaccionesRoutes.get(
  '/',
  validate(listTransaccionesQuerySchema, 'query'),
  asyncHandler(transaccionesController.list),
);

transaccionesRoutes.post(
  '/',
  validate(createTransaccionSchema, 'body'),
  asyncHandler(transaccionesController.create),
);

transaccionesRoutes.get(
  '/summary/:campanaId',
  validate(summaryParamsSchema, 'params'),
  asyncHandler(transaccionesController.summary),
);

transaccionesRoutes.get(
  '/:id',
  validate(transaccionIdParamsSchema, 'params'),
  asyncHandler(transaccionesController.getOne),
);

transaccionesRoutes.patch(
  '/:id',
  validate(transaccionIdParamsSchema, 'params'),
  validate(updateTransaccionSchema, 'body'),
  asyncHandler(transaccionesController.update),
);

transaccionesRoutes.delete(
  '/:id',
  validate(transaccionIdParamsSchema, 'params'),
  asyncHandler(transaccionesController.remove),
);
