import { Router } from 'express';
import { requireAuth, validate } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { membersController } from './members.controller';
import {
  addMemberSchema,
  listMembersQuerySchema,
  memberFincaUserParamsSchema,
  updateMemberRoleSchema,
} from './members.types';

export const membersRoutes: Router = Router();

membersRoutes.use(requireAuth);

membersRoutes.get(
  '/',
  validate(listMembersQuerySchema, 'query'),
  asyncHandler(membersController.list),
);

membersRoutes.post(
  '/',
  validate(addMemberSchema, 'body'),
  asyncHandler(membersController.add),
);

membersRoutes.patch(
  '/:fincaId/:userId',
  validate(memberFincaUserParamsSchema, 'params'),
  validate(updateMemberRoleSchema, 'body'),
  asyncHandler(membersController.updateRole),
);

membersRoutes.delete(
  '/:fincaId/:userId',
  validate(memberFincaUserParamsSchema, 'params'),
  asyncHandler(membersController.remove),
);
