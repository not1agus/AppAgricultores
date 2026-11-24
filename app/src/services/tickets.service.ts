import { api } from '@/services/api';
import type { TransaccionKind } from '@/services/transacciones.service';

export type TicketStatus =
  | 'pending'
  | 'processing'
  | 'done'
  | 'failed'
  | 'manual';

/** All fields optional + nullable: a ticket may be an albarán de entrega
 * (kg, plot, times) or a liquidación (yield, price, total). OCR fills what
 * it can; the user completes the rest. Mirrors backend ticketFieldsSchema. */
export interface TicketFields {
  almazara?: string | null;
  numeroTicket?: string | null;
  fecha?: string | null;
  kgAceituna?: number | null;
  termino?: string | null;
  poligono?: string | null;
  parcela?: string | null;
  recinto?: string | null;
  calidad?: string | null;
  variedad?: string | null;
  lavada?: boolean | null;
  horaInicio?: string | null;
  horaFinal?: string | null;
  duracion?: string | null;
  rendimientoPct?: number | null;
  precioUnitarioEur?: number | null;
  totalEur?: number | null;
  currency?: string | null;
}

export interface Ticket {
  id: string;
  fincaId: string;
  campanaId: string | null;
  transaccionId: string | null;
  imageUrl: string;
  status: TicketStatus;
  /** gasto (money out) or ingreso (money in). */
  kind: TransaccionKind;
  ocrEngine: string | null;
  ocrRawText: string | null;
  ocrConfidence: number | null;
  parsed: TicketFields | null;
  corrected: TicketFields | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTicketInput {
  fincaId: string;
  campanaId?: string;
  imageUrl: string;
  runOcr?: boolean;
  /** gasto (money out) or ingreso (money in). Chosen before scanning. */
  kind?: TransaccionKind;
  notes?: string;
}

export interface UpdateTicketInput {
  campanaId?: string | null;
  corrected?: TicketFields | null;
  kind?: TransaccionKind;
  notes?: string | null;
}

export interface ConfirmTicketInput {
  campanaId: string;
  kind?: TransaccionKind;
  category?: string;
  amountEur?: number;
  occurredAt?: string;
  description?: string;
}

export const ticketsService = {
  listByFinca(fincaId: string): Promise<Ticket[]> {
    return api.get<Ticket[]>('/tickets', { fincaId });
  },
  getById(id: string): Promise<Ticket> {
    return api.get<Ticket>(`/tickets/${id}`);
  },
  create(input: CreateTicketInput): Promise<Ticket> {
    return api.post<Ticket>('/tickets', input);
  },
  update(id: string, input: UpdateTicketInput): Promise<Ticket> {
    return api.patch<Ticket>(`/tickets/${id}`, input);
  },
  rescan(id: string): Promise<Ticket> {
    return api.post<Ticket>(`/tickets/${id}/rescan`);
  },
  confirm(id: string, input: ConfirmTicketInput): Promise<Ticket> {
    return api.post<Ticket>(`/tickets/${id}/confirm`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/tickets/${id}`);
  },
};
