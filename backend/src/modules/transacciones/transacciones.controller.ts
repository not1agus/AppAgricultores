import { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors';
import { transaccionesService } from './transacciones.service';
import {
  CreateTransaccionInput,
  ListTransaccionesQuery,
  UpdateTransaccionInput,
} from './transacciones.types';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED');
  }
  return req.user.id;
}

export const transaccionesController = {
  async list(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const query = req.query as unknown as ListTransaccionesQuery;
    const data = await transaccionesService.list(userId, query);
    res.json({ success: true, data });
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const data = await transaccionesService.getById(
      req.params.id as string,
      userId,
    );
    res.json({ success: true, data });
  },

  async create(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as CreateTransaccionInput;
    const data = await transaccionesService.create(userId, input);
    res.status(201).json({ success: true, data });
  },

  async update(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as UpdateTransaccionInput;
    const data = await transaccionesService.update(
      req.params.id as string,
      userId,
      input,
    );
    res.json({ success: true, data });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    await transaccionesService.remove(req.params.id as string, userId);
    res.status(204).send();
  },

  async summary(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const data = await transaccionesService.summaryByCampana(
      req.params.campanaId as string,
      userId,
    );
    res.json({ success: true, data });
  },
};
