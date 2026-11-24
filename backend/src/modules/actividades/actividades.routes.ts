import { Router } from 'express';
import { requireAuth, validate } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { actividadesController } from './actividades.controller';
import {
  actividadIdParamsSchema,
  createActividadSchema,
  listActividadesQuerySchema,
  updateActividadSchema,
} from './actividades.types';

export const actividadesRoutes: Router = Router();

actividadesRoutes.use(requireAuth);

actividadesRoutes.get(
  '/',
  validate(listActividadesQuerySchema, 'query'),
  asyncHandler(actividadesController.list),
);

actividadesRoutes.post(
  '/',
  validate(createActividadSchema, 'body'),
  asyncHandler(actividadesController.create),
);

actividadesRoutes.get(
  '/:id',
  validate(actividadIdParamsSchema, 'params'),
  asyncHandler(actividadesController.getOne),
);

actividadesRoutes.patch(
  '/:id',
  validate(actividadIdParamsSchema, 'params'),
  validate(updateActividadSchema, 'body'),
  asyncHandler(actividadesController.update),
);

actividadesRoutes.delete(
  '/:id',
  validate(actividadIdParamsSchema, 'params'),
  asyncHandler(actividadesController.remove),
);
