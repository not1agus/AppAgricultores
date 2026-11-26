import { Router } from 'express';
import { requireAuth, validate } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { rentabilidadController } from './rentabilidad.controller';
import { fincaStatsParamsSchema } from './rentabilidad.types';

export const rentabilidadRoutes: Router = Router();

rentabilidadRoutes.use(requireAuth);

rentabilidadRoutes.get(
  '/finca/:fincaId',
  validate(fincaStatsParamsSchema, 'params'),
  asyncHandler(rentabilidadController.fincaStats),
);
