import { Router } from 'express';
import { requireAuth } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { authController } from './auth.controller';

export const authRoutes: Router = Router();

authRoutes.get('/me', requireAuth, asyncHandler(authController.me));
