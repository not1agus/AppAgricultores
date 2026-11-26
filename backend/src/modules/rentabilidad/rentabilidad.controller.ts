import { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors';
import { rentabilidadService } from './rentabilidad.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED');
  }
  return req.user.id;
}

export const rentabilidadController = {
  async fincaStats(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const data = await rentabilidadService.getFincaStats(
      req.params.fincaId as string,
      userId,
    );
    res.json({ success: true, data });
  },
};
