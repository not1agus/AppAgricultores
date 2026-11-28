import { Router } from 'express';
import { requireAuth, validate } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { weatherController } from './weather.controller';
import { forecastQuerySchema } from './weather.types';

export const weatherRoutes: Router = Router();

weatherRoutes.use(requireAuth);

weatherRoutes.get(
  '/forecast',
  validate(forecastQuerySchema, 'query'),
  asyncHandler(weatherController.forecast),
);

weatherRoutes.get('/alerts', asyncHandler(weatherController.alerts));
