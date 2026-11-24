import { Request, Response } from 'express';
import { sigpacService } from './sigpac.service';
import { SigpacReference } from './sigpac.types';

export const sigpacController = {
  async lookup(req: Request, res: Response): Promise<void> {
    const reference = req.body as SigpacReference;
    const data = await sigpacService.fetchByReference(reference);
    res.json({ success: true, data });
  },
};
