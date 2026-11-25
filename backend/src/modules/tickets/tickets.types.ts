import { z } from 'zod';
import { transaccionKindSchema } from '../transacciones/transacciones.types';

export const ticketStatusSchema = z.enum([
  'pending',
  'processing',
  'done',
  'failed',
  'manual',
]);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO date (YYYY-MM-DD)');

// Shape of the parsed/corrected fields for a ticket de almazara.
//
// EVERY field is optional + nullable: this single shape has to cover both
// an albarán de entrega (delivery note: kg of olives, plot, times — no
// money) and a liquidación (settlement: yield %, price, total €). OCR also
// misses fields routinely, and the user fills the gaps by hand. So the
// model never *requires* anything — it's a loose bag of best-effort data.
export const ticketFieldsSchema = z
  .object({
    // Identification
    almazara: z.string().trim().max(200).nullable().optional(),
    numeroTicket: z.string().trim().max(50).nullable().optional(),
    fecha: isoDate.nullable().optional(),
    // Olive delivery / oil yield
    kgAceituna: z.number().nonnegative().nullable().optional(),
    kgAceite: z.number().nonnegative().nullable().optional(),
    // SIGPAC plot reference printed on the delivery note
    termino: z.string().trim().max(120).nullable().optional(),
    poligono: z.string().trim().max(20).nullable().optional(),
    parcela: z.string().trim().max(20).nullable().optional(),
    recinto: z.string().trim().max(20).nullable().optional(),
    // Classification
    calidad: z.string().trim().max(80).nullable().optional(),
    variedad: z.string().trim().max(80).nullable().optional(),
    lavada: z.boolean().nullable().optional(),
    // Milling session times (kept as raw HH:MM:SS strings)
    horaInicio: z.string().trim().max(20).nullable().optional(),
    horaFinal: z.string().trim().max(20).nullable().optional(),
    duracion: z.string().trim().max(20).nullable().optional(),
    // Economic — only present on liquidación tickets
    rendimientoPct: z.number().min(0).max(100).nullable().optional(),
    precioUnitarioEur: z.number().nonnegative().nullable().optional(),
    totalEur: z.number().nonnegative().nullable().optional(),
    currency: z.string().trim().length(3).nullable().optional(),
  })
  .strict();
export type TicketFields = z.infer<typeof ticketFieldsSchema>;

export const ticketIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listTicketsQuerySchema = z.object({
  fincaId: z.string().uuid(),
  campanaId: z.string().uuid().optional(),
  status: ticketStatusSchema.optional(),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

export const createTicketSchema = z
  .object({
    fincaId: z.string().uuid(),
    campanaId: z.string().uuid().optional(),
    imageUrl: z.string().url(),
    // If false, skip OCR and create with status='manual'.
    runOcr: z.boolean().default(true),
    // Whether this ticket represents money going out (gasto) or in
    // (ingreso). Chosen by the user before scanning. Defaults to gasto —
    // the common case (paying the almazara for milling).
    kind: transaccionKindSchema.default('gasto'),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const updateTicketSchema = z
  .object({
    campanaId: z.string().uuid().nullable().optional(),
    corrected: ticketFieldsSchema.nullable().optional(),
    kind: transaccionKindSchema.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const confirmTicketSchema = z
  .object({
    campanaId: z.string().uuid(),
    kind: transaccionKindSchema.default('gasto'),
    category: z.string().trim().min(1).max(80).default('almazara'),
    // If omitted, uses corrected.totalEur ?? parsed.totalEur. If neither
    // is available the request is rejected.
    amountEur: z.number().nonnegative().optional(),
    // If omitted, uses corrected.fecha ?? parsed.fecha ?? today.
    occurredAt: isoDate.optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();
export type ConfirmTicketInput = z.infer<typeof confirmTicketSchema>;

export interface TicketRow {
  id: string;
  finca_id: string;
  campana_id: string | null;
  transaccion_id: string | null;
  image_url: string;
  status: TicketStatus;
  kind: 'ingreso' | 'gasto';
  ocr_engine: string | null;
  ocr_raw_text: string | null;
  ocr_confidence: string | number | null;
  parsed: TicketFields | null;
  corrected: TicketFields | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Ticket {
  id: string;
  fincaId: string;
  campanaId: string | null;
  transaccionId: string | null;
  imageUrl: string;
  status: TicketStatus;
  /** Whether the ticket is money out (gasto) or in (ingreso). */
  kind: 'ingreso' | 'gasto';
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

// Raw response from the OCR sidecar.
//
// `box` is an axis-aligned bounding box [xMin, yMin, xMax, yMax] in pixel
// coordinates of the source image. The parser uses it to reconstruct the
// receipt's table layout — labels and values land on different lines of
// flat text, so geometry is the only reliable way to pair them.
export interface OcrLineBox {
  text: string;
  confidence: number;
  box?: [number, number, number, number];
}

export interface OcrEngineResponse {
  engine: string;
  text: string;
  avgConfidence: number | null;
  lines?: OcrLineBox[];
}
