import { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors';
import { parcelasService } from './parcelas.service';
import {
  CreateParcelaFromSigpacInput,
  CreateParcelaInput,
  ListParcelasQuery,
  UpdateParcelaInput,
} from './parcelas.types';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED');
  }
  return req.user.id;
}

export const parcelasController = {
  async list(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const { fincaId } = req.query as unknown as ListParcelasQuery;
    const data = await parcelasService.listByFinca(fincaId, userId);
    res.json({ success: true, data });
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const data = await parcelasService.getById(req.params.id as string, userId);
    res.json({ success: true, data });
  },

  async create(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as CreateParcelaInput;
    const data = await parcelasService.create(userId, input);
    res.status(201).json({ success: true, data });
  },

  async createFromSigpac(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as CreateParcelaFromSigpacInput;
    const data = await parcelasService.createFromSigpac(userId, input);
    res.status(201).json({ success: true, data });
  },

  async update(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as UpdateParcelaInput;
    const data = await parcelasService.update(
      req.params.id as string,
      userId,
      input,
    );
    res.json({ success: true, data });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    await parcelasService.remove(req.params.id as string, userId);
    res.status(204).send();
  },
};
