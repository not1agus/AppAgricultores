import { Router } from 'express';
import { requireAuth, validate } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { campanasController } from './campanas.controller';
import {
  campanaIdParamsSchema,
  createCampanaSchema,
  listCampanasQuerySchema,
  updateCampanaSchema,
} from './campanas.types';

export const campanasRoutes: Router = Router();

campanasRoutes.use(requireAuth);

campanasRoutes.get(
  '/',
  validate(listCampanasQuerySchema, 'query'),
  asyncHandler(campanasController.list),
);

campanasRoutes.post(
  '/',
  validate(createCampanaSchema, 'body'),
  asyncHandler(campanasController.create),
);

campanasRoutes.get(
  '/:id',
  validate(campanaIdParamsSchema, 'params'),
  asyncHandler(campanasController.getOne),
);

campanasRoutes.patch(
  '/:id',
  validate(campanaIdParamsSchema, 'params'),
  validate(updateCampanaSchema, 'body'),
  asyncHandler(campanasController.update),
);

campanasRoutes.delete(
  '/:id',
  validate(campanaIdParamsSchema, 'params'),
  asyncHandler(campanasController.remove),
);
