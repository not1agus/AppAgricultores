import { Router } from 'express';
import { requireAuth, validate } from '../../common/middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { ticketsController } from './tickets.controller';
import {
  confirmTicketSchema,
  createTicketSchema,
  listTicketsQuerySchema,
  ticketIdParamsSchema,
  updateTicketSchema,
} from './tickets.types';

export const ticketsRoutes: Router = Router();

ticketsRoutes.use(requireAuth);

ticketsRoutes.get(
  '/',
  validate(listTicketsQuerySchema, 'query'),
  asyncHandler(ticketsController.list),
);

ticketsRoutes.post(
  '/',
  validate(createTicketSchema, 'body'),
  asyncHandler(ticketsController.create),
);

ticketsRoutes.get(
  '/:id',
  validate(ticketIdParamsSchema, 'params'),
  asyncHandler(ticketsController.getOne),
);

ticketsRoutes.patch(
  '/:id',
  validate(ticketIdParamsSchema, 'params'),
  validate(updateTicketSchema, 'body'),
  asyncHandler(ticketsController.update),
);

ticketsRoutes.post(
  '/:id/rescan',
  validate(ticketIdParamsSchema, 'params'),
  asyncHandler(ticketsController.rescan),
);

ticketsRoutes.post(
  '/:id/confirm',
  validate(ticketIdParamsSchema, 'params'),
  validate(confirmTicketSchema, 'body'),
  asyncHandler(ticketsController.confirm),
);

ticketsRoutes.delete(
  '/:id',
  validate(ticketIdParamsSchema, 'params'),
  asyncHandler(ticketsController.remove),
);
