import { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors';
import { ticketsService } from './tickets.service';
import {
  ConfirmTicketInput,
  CreateTicketInput,
  ListTicketsQuery,
  UpdateTicketInput,
} from './tickets.types';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED');
  }
  return req.user.id;
}

export const ticketsController = {
  async list(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const query = req.query as unknown as ListTicketsQuery;
    const data = await ticketsService.list(userId, query);
    res.json({ success: true, data });
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const data = await ticketsService.getById(req.params.id as string, userId);
    res.json({ success: true, data });
  },

  async create(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as CreateTicketInput;
    const data = await ticketsService.create(userId, input);
    res.status(201).json({ success: true, data });
  },

  async update(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as UpdateTicketInput;
    const data = await ticketsService.update(
      req.params.id as string,
      userId,
      input,
    );
    res.json({ success: true, data });
  },

  async rescan(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const data = await ticketsService.rescan(req.params.id as string, userId);
    res.json({ success: true, data });
  },

  async confirm(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as ConfirmTicketInput;
    const data = await ticketsService.confirm(
      req.params.id as string,
      userId,
      input,
    );
    res.json({ success: true, data });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    await ticketsService.remove(req.params.id as string, userId);
    res.status(204).send();
  },
};
