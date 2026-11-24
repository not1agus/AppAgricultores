import { Router } from 'express';
import { requireAuth, validate } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { fincasController } from './fincas.controller';
import {
  createFincaSchema,
  fincaIdParamsSchema,
  updateFincaSchema,
} from './fincas.types';

export const fincasRoutes: Router = Router();

fincasRoutes.use(requireAuth);

fincasRoutes.get('/', asyncHandler(fincasController.list));

fincasRoutes.post(
  '/',
  validate(createFincaSchema, 'body'),
  asyncHandler(fincasController.create),
);

fincasRoutes.get(
  '/:id',
  validate(fincaIdParamsSchema, 'params'),
  asyncHandler(fincasController.getOne),
);

fincasRoutes.patch(
  '/:id',
  validate(fincaIdParamsSchema, 'params'),
  validate(updateFincaSchema, 'body'),
  asyncHandler(fincasController.update),
);

fincasRoutes.delete(
  '/:id',
  validate(fincaIdParamsSchema, 'params'),
  asyncHandler(fincasController.remove),
);
