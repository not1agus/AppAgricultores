import { Router } from 'express';
import { requireAuth, validate } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sigpacController } from './sigpac.controller';
import { lookupBodySchema } from './sigpac.types';

export const sigpacRoutes: Router = Router();

sigpacRoutes.use(requireAuth);

sigpacRoutes.post(
  '/lookup',
  validate(lookupBodySchema, 'body'),
  asyncHandler(sigpacController.lookup),
);
