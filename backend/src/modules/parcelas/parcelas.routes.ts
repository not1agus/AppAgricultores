import { Router } from 'express';
import { requireAuth, validate } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { parcelasController } from './parcelas.controller';
import {
  createParcelaFromSigpacSchema,
  createParcelaSchema,
  listParcelasQuerySchema,
  parcelaIdParamsSchema,
  updateParcelaSchema,
} from './parcelas.types';

export const parcelasRoutes: Router = Router();

parcelasRoutes.use(requireAuth);

parcelasRoutes.get(
  '/',
  validate(listParcelasQuerySchema, 'query'),
  asyncHandler(parcelasController.list),
);

parcelasRoutes.post(
  '/',
  validate(createParcelaSchema, 'body'),
  asyncHandler(parcelasController.create),
);

parcelasRoutes.post(
  '/from-sigpac',
  validate(createParcelaFromSigpacSchema, 'body'),
  asyncHandler(parcelasController.createFromSigpac),
);

parcelasRoutes.get(
  '/:id',
  validate(parcelaIdParamsSchema, 'params'),
  asyncHandler(parcelasController.getOne),
);

parcelasRoutes.patch(
  '/:id',
  validate(parcelaIdParamsSchema, 'params'),
  validate(updateParcelaSchema, 'body'),
  asyncHandler(parcelasController.update),
);

parcelasRoutes.delete(
  '/:id',
  validate(parcelaIdParamsSchema, 'params'),
  asyncHandler(parcelasController.remove),
);
