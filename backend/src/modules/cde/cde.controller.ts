import { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors';
import { cdeService } from './cde.service';
import { CdePreviewInput } from './cde.types';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED');
  }
  return req.user.id;
}

export const cdeController = {
  async preview(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const data = await cdeService.preview(userId, req.body as CdePreviewInput);
    res.json({ success: true, data });
  },
};
