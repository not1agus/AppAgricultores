import { Router } from 'express';
import { requireAuth, validate } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { cdeController } from './cde.controller';
import { cdePreviewSchema } from './cde.types';

export const cdeRoutes: Router = Router();

cdeRoutes.use(requireAuth);

cdeRoutes.post(
  '/preview',
  validate(cdePreviewSchema, 'body'),
  asyncHandler(cdeController.preview),
);
