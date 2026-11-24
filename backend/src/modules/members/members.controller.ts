import { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors';
import { membersService } from './members.service';
import {
  AddMemberInput,
  ListMembersQuery,
  MemberFincaUserParams,
  UpdateMemberRoleInput,
} from './members.types';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED');
  }
  return req.user.id;
}

export const membersController = {
  async list(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const { fincaId } = req.query as unknown as ListMembersQuery;
    const data = await membersService.list(fincaId, userId);
    res.json({ success: true, data });
  },

  async add(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const input = req.body as AddMemberInput;
    const data = await membersService.add(userId, input);
    res.status(201).json({ success: true, data });
  },

  async updateRole(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const { fincaId, userId: targetUserId } =
      req.params as unknown as MemberFincaUserParams;
    const { role } = req.body as UpdateMemberRoleInput;
    const data = await membersService.updateRole(
      fincaId,
      targetUserId,
      userId,
      role,
    );
    res.json({ success: true, data });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const userId = requireUserId(req);
    const { fincaId, userId: targetUserId } =
      req.params as unknown as MemberFincaUserParams;
    await membersService.remove(fincaId, targetUserId, userId);
    res.status(204).send();
  },
};
