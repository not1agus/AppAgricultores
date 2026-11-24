import { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors';
import { fincasService } from './fincas.service';
import { CreateFincaInput, UpdateFincaInput } from './fincas.types';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED');
  }
  return req.user.id;
}

export const fincasController = {
  async list(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const data = await fincasService.listForUser(userId);
    res.json({ success: true, data });
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const data = await fincasService.getById(req.params.id as string, userId);
    res.json({ success: true, data });
  },

  async create(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as CreateFincaInput;
    const data = await fincasService.create(userId, input);
    res.status(201).json({ success: true, data });
  },

  async update(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as UpdateFincaInput;
    const data = await fincasService.update(req.params.id as string, userId, input);
    res.json({ success: true, data });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    await fincasService.remove(req.params.id as string, userId);
    res.status(204).send();
  },
};
