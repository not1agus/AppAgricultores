import { Router } from 'express';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { requireAuth } from '../../common/middleware/auth';
import { validate } from '../../common/middleware/validate';
import { aiController } from './ai.controller';
import { chatRequestSchema } from './ai.types';

export const aiRoutes: Router = Router();

aiRoutes.post(
  '/chat',
  requireAuth,
  validate(chatRequestSchema, 'body'),
  asyncHandler(aiController.chat),
);
