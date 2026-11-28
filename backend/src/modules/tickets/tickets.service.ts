import { createWorker } from 'tesseract.js';
import { env, getSupabaseServiceClient } from '../../config';
import {
  AppError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors';
import { logger } from '../../common/utils/logger';
import { fincasService } from '../fincas/fincas.service';
import { transaccionesService } from '../transacciones/transacciones.service';
import {
  ConfirmTicketInput,
  CreateTicketInput,
  ListTicketsQuery,
  OcrEngineResponse,
  OcrLineBox,
  Ticket,
  TicketFields,
  TicketRow,
  UpdateTicketInput,
} from './tickets.types';
import { parseTicketFields } from './tickets.parser';

const TICKET_COLUMNS =
  'id, finca_id, campana_id, transaccion_id, image_url, status, kind, ' +
  'ocr_engine, ocr_raw_text, ocr_confidence, parsed, corrected, notes, ' +
  'created_by, created_at, updated_at';

class OcrServiceError extends AppError {
  constructor(message: string, code = 'OCR_SERVICE_ERROR', statusCode = 502) {
    super(message, statusCode, code);
  }
}

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    fincaId: row.finca_id,
    campanaId: row.campana_id,
    transaccionId: row.transaccion_id,
    imageUrl: row.image_url,
    status: row.status,
    kind: row.kind,
    ocrEngine: row.ocr_engine,
    ocrRawText: row.ocr_raw_text,
    ocrConfidence: row.ocr_confidence === null ? null : Number(row.ocr_confidence),
    parsed: row.parsed,
    corrected: row.corrected,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadOrThrow(ticketId: string): Promise<TicketRow> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('tickets')
    .select(TICKET_COLUMNS)
    .eq('id', ticketId)
    .single();
  if (error || !data) {
    throw new NotFoundError('Ticket not found', 'TICKET_NOT_FOUND');
  }
  return data as unknown as TicketRow;
}

async function assertCanMutate(
  row: TicketRow,
  userId: string,
  action: 'edit' | 'delete' | 'confirm',
): Promise<void> {
  const role = await fincasService.assertMember(row.finca_id, userId);
  if (row.created_by !== userId && role !== 'owner') {
    throw new ForbiddenError(
      `Only the creator or a finca owner can ${action} this ticket`,
      'FORBIDDEN_TICKET',
    );
  }
}

// ---------- OCR engine ----------

// Descarga la imagen desde la URL y devuelve un Buffer.
// Tesseract.js en Node.js acepta URL directamente pero Supabase Storage
// puede requerir autenticación o dar problemas de CORS; descargar aquí
// es más seguro y evita redireccionamientos inesperados.
async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(imageUrl, { signal: controller.signal });
    if (!res.ok) {
      throw new OcrServiceError(
        `Image download failed with status ${res.status}`,
        'OCR_IMAGE_FETCH_ERROR',
      );
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof OcrServiceError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new OcrServiceError('Image download timed out', 'OCR_IMAGE_TIMEOUT');
    }
    throw new OcrServiceError(
      err instanceof Error ? err.message : 'Image download failed',
      'OCR_IMAGE_FETCH_ERROR',
    );
  } finally {
    clearTimeout(timer);
  }
}

// Tipos internos de Tesseract que el paquete no exporta en esta versión.
interface TesseractBbox { x0: number; y0: number; x1: number; y1: number }
interface TesseractLine { text: string; confidence: number; bbox: TesseractBbox }
interface TesseractData {
  text: string;
  confidence: number;
  lines: TesseractLine[];
}

// Motor integrado con Tesseract.js — no requiere sidecar externo.
// Descarga los datos de idioma (~12 MB spa+eng) en el primer uso y los
// cachea en disco; los usos posteriores arrancan en < 1 s.
async function runTesseractOcr(imageUrl: string): Promise<OcrEngineResponse> {
  const imageBuffer = await fetchImageBuffer(imageUrl);

  const worker = await createWorker('spa+eng', 1, {
    logger: (m: { status: string; progress?: number }) => {
      if (m.status !== 'recognizing text') return;
      logger.debug('Tesseract progress', { progress: m.progress });
    },
  });

  try {
    const result = await worker.recognize(imageBuffer);
    // Los typings del paquete en esta versión no exponen `lines` en Page;
    // el objeto en runtime sí lo incluye — usamos un cast explícito.
    const data = result.data as unknown as TesseractData;

    const lines: OcrLineBox[] = data.lines
      .map((line) => ({
        text: line.text.trim(),
        confidence: line.confidence,
        box: [
          line.bbox.x0,
          line.bbox.y0,
          line.bbox.x1,
          line.bbox.y1,
        ] as [number, number, number, number],
      }))
      .filter((l) => l.text.length > 0);

    return {
      engine: 'tesseract',
      text: data.text,
      avgConfidence: data.confidence > 0 ? data.confidence / 100 : null,
      lines,
    };
  } finally {
    await worker.terminate();
  }
}

// Motor externo PaddleOCR (sidecar). Se usa sólo si OCR_SERVICE_URL está
// configurado; en caso contrario se cae a Tesseract automáticamente.
async function callPaddleOcr(imageUrl: string): Promise<OcrEngineResponse> {
  const url = new URL('/ocr', env.OCR_SERVICE_URL!).toString();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    env.OCR_SERVICE_TIMEOUT_MS,
  );
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ imageUrl }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new OcrServiceError(`Upstream returned status ${res.status}`);
    }
    const json = (await res.json()) as Partial<OcrEngineResponse>;
    if (typeof json.text !== 'string') {
      throw new OcrServiceError('Upstream returned malformed response');
    }
    return {
      engine: typeof json.engine === 'string' ? json.engine : 'paddleocr',
      text: json.text,
      avgConfidence:
        typeof json.avgConfidence === 'number' ? json.avgConfidence : null,
      lines: Array.isArray(json.lines) ? json.lines : undefined,
    };
  } catch (err) {
    if (err instanceof OcrServiceError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new OcrServiceError('OCR request timed out', 'OCR_TIMEOUT');
    }
    throw new OcrServiceError(
      err instanceof Error ? err.message : 'OCR request failed',
    );
  } finally {
    clearTimeout(timer);
  }
}

async function callOcrEngine(imageUrl: string): Promise<OcrEngineResponse> {
  if (env.OCR_SERVICE_URL) {
    return callPaddleOcr(imageUrl);
  }
  return runTesseractOcr(imageUrl);
}

// ---------- Heuristic parser (raw OCR text -> structured fields) ----------
// All parsing logic lives in tickets.parser.ts (pure, testable functions).
// parseTicketFields is imported above.

// ---------- OCR flow ----------

async function runOcr(ticketId: string, imageUrl: string): Promise<TicketRow> {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from('tickets')
    .update({ status: 'processing' })
    .eq('id', ticketId);

  try {
    const result = await callOcrEngine(imageUrl);
    const parsed = parseTicketFields(result);
    const { data, error } = await supabase
      .from('tickets')
      .update({
        status: 'done',
        ocr_engine: result.engine,
        ocr_raw_text: result.text,
        ocr_confidence: result.avgConfidence,
        parsed,
      })
      .eq('id', ticketId)
      .select(TICKET_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new Error('Failed to persist OCR result');
    }
    return data as unknown as TicketRow;
  } catch (err) {
    logger.warn('Ticket OCR failed', {
      ticketId,
      error: err instanceof Error ? err.message : String(err),
    });
    await supabase
      .from('tickets')
      .update({ status: 'failed' })
      .eq('id', ticketId);
    throw err;
  }
}

// ---------- Public API ----------

export const ticketsService = {
  async list(userId: string, q: ListTicketsQuery): Promise<Ticket[]> {
    await fincasService.assertMember(q.fincaId, userId);

    const supabase = getSupabaseServiceClient();
    let query = supabase
      .from('tickets')
      .select(TICKET_COLUMNS)
      .eq('finca_id', q.fincaId)
      .order('created_at', { ascending: false });

    if (q.campanaId) query = query.eq('campana_id', q.campanaId);
    if (q.status) query = query.eq('status', q.status);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => toTicket(row as unknown as TicketRow));
  },

  async getById(ticketId: string, userId: string): Promise<Ticket> {
    const row = await loadOrThrow(ticketId);
    await fincasService.assertMember(row.finca_id, userId);
    return toTicket(row);
  },

  async create(userId: string, input: CreateTicketInput): Promise<Ticket> {
    await fincasService.assertMember(input.fincaId, userId);

    // Sanity-check the optional campaña belongs to the same finca.
    if (input.campanaId) {
      const supabase = getSupabaseServiceClient();
      const { data, error } = await supabase
        .from('campanas')
        .select('finca_id')
        .eq('id', input.campanaId)
        .single();
      if (error || !data) {
        throw new NotFoundError('Campana not found', 'CAMPANA_NOT_FOUND');
      }
      if (data.finca_id !== input.fincaId) {
        throw new BadRequestError(
          'Campana does not belong to the given finca',
          'CAMPANA_FINCA_MISMATCH',
        );
      }
    }

    // Tesseract.js está disponible incluso sin OCR_SERVICE_URL, así que
    // el OCR siempre puede correr si el cliente lo pide.
    const shouldRunOcr = Boolean(input.runOcr);
    const initialStatus = shouldRunOcr ? 'pending' : 'manual';

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('tickets')
      .insert({
        finca_id: input.fincaId,
        campana_id: input.campanaId ?? null,
        image_url: input.imageUrl,
        status: initialStatus,
        kind: input.kind,
        notes: input.notes ?? null,
        created_by: userId,
      })
      .select(TICKET_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new Error('Failed to create ticket');
    }

    let row = data as unknown as TicketRow;
    if (shouldRunOcr) {
      // Synchronous: OCR usually completes within a few seconds per ticket,
      // and the client wants the parsed fields back in the same call. If
      // this becomes a latency problem, move to a job queue and poll.
      try {
        row = await runOcr(row.id, row.image_url);
      } catch {
        // OCR failed; ticket still exists with status='failed'. Surface the
        // latest persisted row so the client can show it in the UI.
        row = await loadOrThrow(row.id);
      }
    }
    return toTicket(row);
  },

  async update(
    ticketId: string,
    userId: string,
    input: UpdateTicketInput,
  ): Promise<Ticket> {
    const row = await loadOrThrow(ticketId);
    await assertCanMutate(row, userId, 'edit');

    // If the user reassigns campaña, ensure it still belongs to this finca.
    if (input.campanaId) {
      const supabase = getSupabaseServiceClient();
      const { data, error } = await supabase
        .from('campanas')
        .select('finca_id')
        .eq('id', input.campanaId)
        .single();
      if (error || !data) {
        throw new NotFoundError('Campana not found', 'CAMPANA_NOT_FOUND');
      }
      if (data.finca_id !== row.finca_id) {
        throw new BadRequestError(
          'Campana does not belong to this ticket finca',
          'CAMPANA_FINCA_MISMATCH',
        );
      }
    }

    const patch: Record<string, unknown> = {};
    if (input.campanaId !== undefined) patch['campana_id'] = input.campanaId;
    if (input.corrected !== undefined) patch['corrected'] = input.corrected;
    if (input.kind !== undefined) patch['kind'] = input.kind;
    if (input.notes !== undefined) patch['notes'] = input.notes;

    if (Object.keys(patch).length === 0) {
      return toTicket(row);
    }

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('tickets')
      .update(patch)
      .eq('id', ticketId)
      .select(TICKET_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new NotFoundError('Ticket not found', 'TICKET_NOT_FOUND');
    }
    return toTicket(data as unknown as TicketRow);
  },

  async rescan(ticketId: string, userId: string): Promise<Ticket> {
    const row = await loadOrThrow(ticketId);
    await assertCanMutate(row, userId, 'edit');
    const updated = await runOcr(ticketId, row.image_url);
    return toTicket(updated);
  },

  async confirm(
    ticketId: string,
    userId: string,
    input: ConfirmTicketInput,
  ): Promise<Ticket> {
    const row = await loadOrThrow(ticketId);
    await assertCanMutate(row, userId, 'confirm');

    if (row.transaccion_id) {
      throw new BadRequestError(
        'Ticket is already confirmed',
        'TICKET_ALREADY_CONFIRMED',
      );
    }

    const fields: TicketFields = row.corrected ?? row.parsed ?? {};
    const amountEur =
      input.amountEur ??
      (fields.totalEur ?? undefined) ??
      undefined;
    if (amountEur === undefined || amountEur === null) {
      throw new BadRequestError(
        'amountEur is required (no value in corrected/parsed)',
        'TICKET_AMOUNT_MISSING',
      );
    }

    const occurredAt =
      input.occurredAt ??
      fields.fecha ??
      new Date().toISOString().slice(0, 10);

    const description =
      input.description ??
      (fields.almazara ? `Ticket almazara: ${fields.almazara}` : undefined);

    const transaccion = await transaccionesService.create(userId, {
      campanaId: input.campanaId,
      kind: input.kind,
      category: input.category,
      occurredAt,
      amountEur,
      description,
    });

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('tickets')
      .update({
        transaccion_id: transaccion.id,
        campana_id: input.campanaId,
      })
      .eq('id', ticketId)
      .select(TICKET_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new NotFoundError('Ticket not found', 'TICKET_NOT_FOUND');
    }
    return toTicket(data as unknown as TicketRow);
  },

  async remove(ticketId: string, userId: string): Promise<void> {
    const row = await loadOrThrow(ticketId);
    await assertCanMutate(row, userId, 'delete');

    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from('tickets').delete().eq('id', ticketId);
    if (error) throw error;
  },
};
