import { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors';
import { MeResponse } from './auth.types';

export const authController = {
  async me(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED');
    }
    const body: MeResponse = {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      isBlocked: req.user.isBlocked,
    };
    res.json({ success: true, data: body });
  },
};
