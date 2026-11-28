import { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors';
import { actividadesService } from './actividades.service';
import {
  CreateActividadInput,
  ListActividadesQuery,
  UpdateActividadInput,
} from './actividades.types';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED');
  }
  return req.user.id;
}

export const actividadesController = {
  async list(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const query = req.query as unknown as ListActividadesQuery;
    const data = await actividadesService.list(userId, query);
    res.json({ success: true, data });
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const data = await actividadesService.getById(req.params.id as string, userId);
    res.json({ success: true, data });
  },

  async create(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as CreateActividadInput;
    const data = await actividadesService.create(userId, input);
    res.status(201).json({ success: true, data });
  },

  async update(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as UpdateActividadInput;
    const data = await actividadesService.update(
      req.params.id as string,
      userId,
      input,
    );
    res.json({ success: true, data });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    await actividadesService.remove(req.params.id as string, userId);
    res.status(204).send();
  },
};
