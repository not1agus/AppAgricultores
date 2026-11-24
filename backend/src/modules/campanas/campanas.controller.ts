import { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors';
import { campanasService } from './campanas.service';
import {
  CreateCampanaInput,
  ListCampanasQuery,
  UpdateCampanaInput,
} from './campanas.types';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED');
  }
  return req.user.id;
}

export const campanasController = {
  async list(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const query = req.query as unknown as ListCampanasQuery;
    const data = await campanasService.list(userId, query);
    res.json({ success: true, data });
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const data = await campanasService.getById(req.params.id as string, userId);
    res.json({ success: true, data });
  },

  async create(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as CreateCampanaInput;
    const data = await campanasService.create(userId, input);
    res.status(201).json({ success: true, data });
  },

  async update(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as UpdateCampanaInput;
    const data = await campanasService.update(
      req.params.id as string,
      userId,
      input,
    );
    res.json({ success: true, data });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    await campanasService.remove(req.params.id as string, userId);
    res.status(204).send();
  },
};
