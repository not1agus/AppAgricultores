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

const DATE_REGEXES: RegExp[] = [
  /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/, // 2025-01-30 or 2025/1/30
  /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/, // 30/01/2025
];

function parseDate(text: string): string | null {
  for (const re of DATE_REGEXES) {
    const m = re.exec(text);
    if (!m) continue;
    let y: number;
    let mo: number;
    let d: number;
    if (re === DATE_REGEXES[0]) {
      y = Number(m[1]);
      mo = Number(m[2]);
      d = Number(m[3]);
    } else {
      d = Number(m[1]);
      mo = Number(m[2]);
      y = Number(m[3]);
      if (y < 100) y += 2000;
    }
    if (
      Number.isFinite(y) &&
      Number.isFinite(mo) &&
      Number.isFinite(d) &&
      y >= 2000 &&
      y <= 2100 &&
      mo >= 1 &&
      mo <= 12 &&
      d >= 1 &&
      d <= 31
    ) {
      return `${y.toString().padStart(4, '0')}-${mo
        .toString()
        .padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
    }
  }
  return null;
}

/** Parse a Spanish-formatted number ("1.234,56" or "1234.56") to a float. */
function parseEsNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasComma = trimmed.includes(',');
  const hasDot = trimmed.includes('.');
  let normalized: string;
  if (hasComma && hasDot) {
    // Decimal separator is whichever appears last.
    normalized =
      trimmed.lastIndexOf(',') > trimmed.lastIndexOf('.')
        ? trimmed.replace(/\./g, '').replace(',', '.')
        : trimmed.replace(/,/g, '');
  } else if (hasComma) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = trimmed;
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

// --- Spanish month-name dates -----------------------------------------------
// Almazara tickets often print the date spelled out ("11 de marzo de 2026")
// rather than numerically; the numeric DATE_REGEXES above miss those.
const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function parseSpanishDate(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [name, mo] of Object.entries(SPANISH_MONTHS)) {
    const idx = lower.indexOf(name);
    if (idx === -1) continue;
    // Day: the last 1-2 digit run in the ~12 chars before the month name.
    const before = lower.slice(Math.max(0, idx - 14), idx);
    const dayMatch = /(\d{1,2})\D*$/.exec(before);
    // Year: a 20xx in the ~20 chars from the month onward.
    const yearMatch = /(20\d{2})/.exec(lower.slice(idx, idx + 24));
    if (dayMatch && yearMatch) {
      const d = Number(dayMatch[1]);
      const y = Number(yearMatch[1]);
      if (d >= 1 && d <= 31) {
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

// --- Spatial parser ----------------------------------------------------------
// A ticket is a table. OCR returns each fragment with a bounding box; we use
// the geometry to pair a label (e.g. "Total (Kg.)") with its value (the big
// "249" sitting in the cell below it). Flat-text proximity fails here because
// unrelated cells interleave in reading order.

interface PlacedLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  h: number;
}

function toPlacedLines(lines: OcrLineBox[]): PlacedLine[] {
  const out: PlacedLine[] = [];
  for (const l of lines) {
    if (!l.box) continue;
    const [x0, y0, x1, y1] = l.box;
    out.push({
      text: l.text,
      x0,
      y0,
      x1,
      y1,
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      h: Math.max(1, y1 - y0),
    });
  }
  return out;
}

/** Extract the last numeric token from a string, parsed as a Spanish number.
 * "N.Ticket: 9.276" -> 9276 ; "249" -> 249 ; "SUELO" -> null. */
function extractNumber(text: string): number | null {
  const matches = text.match(/\d[\d.,]*/g);
  if (!matches || matches.length === 0) return null;
  return parseEsNumber(matches[matches.length - 1]!);
}

/** True when the line is essentially just a number (the value cell of a
 * table), tolerating a trailing unit like "Kg" or a "%". */
function isNumericLine(text: string): boolean {
  return /^[\s]*\d[\d.,\s]*(kg|%|€|l)?[\s]*$/i.test(text);
}

/** Horizontal overlap ratio of two lines, 0..1 over the narrower one. */
function xOverlapRatio(a: PlacedLine, b: PlacedLine): number {
  const lo = Math.max(a.x0, b.x0);
  const hi = Math.min(a.x1, b.x1);
  const overlap = Math.max(0, hi - lo);
  const narrow = Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0));
  return overlap / narrow;
}

/**
 * Find the numeric value belonging to a label line. Considers two layouts:
 *  - same row: a numeric cell to the right, vertically aligned
 *  - below: a numeric cell in the cell beneath, horizontally overlapping
 * Returns null when nothing numeric sits close enough — deliberately, so an
 * empty field on the ticket stays empty instead of grabbing a stray number.
 */
function valueForLabel(
  label: PlacedLine,
  placed: PlacedLine[],
): number | null {
  let best: { score: number; value: number } | null = null;
  for (const cand of placed) {
    if (cand === label) continue;
    // In-line value (label and number share the cell, e.g. "Socio: 2.024").
    // Handled separately by the caller; here we only want separate cells.
    if (!isNumericLine(cand.text)) continue;
    const value = extractNumber(cand.text);
    if (value === null) continue;

    // Same-row: similar cy, candidate starts to the right of the label.
    const sameRow =
      Math.abs(cand.cy - label.cy) < label.h * 0.8 && cand.x0 >= label.x0;
    if (sameRow) {
      const gap = Math.abs(cand.x0 - label.x1);
      const score = gap / 400; // normalise; horizontal gaps are wide
      if (!best || score < best.score) best = { score, value };
      continue;
    }
    // Below: candidate sits under the label and overlaps it horizontally.
    const below = cand.cy > label.cy && xOverlapRatio(label, cand) > 0.25;
    if (below) {
      const gap = cand.y0 - label.y1;
      if (gap > label.h * 6) continue; // too far down to be related
      const score = Math.max(0, gap) / (label.h * 3);
      if (!best || score < best.score) best = { score, value };
    }
  }
  // Reject matches that are implausibly far (score >= 1 ~ "another cell").
  if (best && best.score < 1) return best.value;
  return null;
}

/** Locate a label line by keyword(s) (all must be present, case-insensitive)
 * and return both the line and any number already inside it. */
function findLabel(
  placed: PlacedLine[],
  keywords: string[],
): { line: PlacedLine; inlineValue: number | null } | null {
  for (const line of placed) {
    const lower = line.text.toLowerCase();
    if (keywords.every((k) => lower.includes(k))) {
      return { line, inlineValue: extractNumber(line.text) };
    }
  }
  return null;
}

/** Resolve a numeric field: prefer an inline value, else a spatial one. */
function resolveNumber(
  placed: PlacedLine[],
  keywordSets: string[][],
): number | null {
  for (const keywords of keywordSets) {
    const hit = findLabel(placed, keywords);
    if (!hit) continue;
    if (hit.inlineValue !== null) return hit.inlineValue;
    const spatial = valueForLabel(hit.line, placed);
    if (spatial !== null) return spatial;
  }
  return null;
}

/** Nearest value LINE (numeric or not) to the right of / below a label.
 * Used for string-valued fields (término, calidad, variedad…). Skips lines
 * that are themselves labels (trailing ':'). */
function textValueForLabel(
  label: PlacedLine,
  placed: PlacedLine[],
): string | null {
  let best: { score: number; text: string } | null = null;
  for (const cand of placed) {
    if (cand === label) continue;
    const t = cand.text.trim();
    if (!t || /:\s*$/.test(t)) continue;
    const sameRow =
      Math.abs(cand.cy - label.cy) < label.h * 0.8 &&
      cand.x0 >= label.x1 - label.h;
    if (sameRow) {
      const score = Math.abs(cand.x0 - label.x1) / 400;
      if (!best || score < best.score) best = { score, text: t };
      continue;
    }
    const below = cand.cy > label.cy && xOverlapRatio(label, cand) > 0.25;
    if (below) {
      const gap = cand.y0 - label.y1;
      if (gap > label.h * 4) continue;
      const score = Math.max(0, gap) / (label.h * 3);
      if (!best || score < best.score) best = { score, text: t };
    }
  }
  return best && best.score < 1 ? best.text : null;
}

/** Resolve a string field: prefer the text after the ':' on the label line,
 * else the spatially-nearest value line. */
function resolveText(
  placed: PlacedLine[],
  keywordSets: string[][],
): string | null {
  for (const keywords of keywordSets) {
    const hit = findLabel(placed, keywords);
    if (!hit) continue;
    const colonIdx = hit.line.text.indexOf(':');
    if (colonIdx !== -1) {
      const inline = hit.line.text.slice(colonIdx + 1).trim();
      if (inline) return inline;
    }
    const spatial = textValueForLabel(hit.line, placed);
    if (spatial) return spatial;
  }
  return null;
}

/** Extract milling-session times. A ticket prints three HH:MM:SS values:
 * start, end and duration. Duration is the one whose hour part is "00"
 * (a session lasts minutes); of the remaining clock times the earlier is
 * the start and the later the end. */
function parseTimes(text: string): {
  inicio: string | null;
  final: string | null;
  duracion: string | null;
} {
  const all = text.match(/\b\d{1,2}:\d{2}:\d{2}\b/g) ?? [];
  let duracion: string | null = null;
  const clock: string[] = [];
  for (const t of all) {
    if (/^0?0:/.test(t)) {
      duracion = duracion ?? t;
    } else {
      clock.push(t);
    }
  }
  clock.sort();
  return {
    inicio: clock[0] ?? null,
    final: clock.length > 1 ? clock[clock.length - 1]! : null,
    duracion,
  };
}

/** "Lavada: SI / NO" -> boolean. */
function parseLavada(text: string): boolean | null {
  const m = /lavad[ao]\s*:?\s*(s[ií]|no)/i.exec(text);
  if (!m) return null;
  return /^s/i.test(m[1]!);
}

/** OCR commonly turns the "/" in an almazara code ("14/40094") into a
 * letter. If the value looks like digits-letter-digits, restore the slash. */
function cleanCode(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{1,4})\s*[a-zA-Z]\s*(\d{2,6})$/.exec(raw.trim());
  return m ? `${m[1]}/${m[2]}` : raw.trim();
}

/**
 * Parse OCR output into structured ticket fields. Uses the spatial layout
 * when the engine provided bounding boxes; falls back to a flat-text scan
 * otherwise (older engine or malformed response).
 *
 * Every field is best-effort: the user reviews and corrects on screen, so
 * the priority is "never put a wrong value" over "fill everything".
 */
function parseTicketFields(result: OcrEngineResponse): TicketFields {
  const text = result.text;
  const fecha = parseDate(text) ?? parseSpanishDate(text);
  const currency = /€|eur/i.test(text) ? 'EUR' : null;
  const times = parseTimes(text);
  const lavada = parseLavada(text);

  const placed = toPlacedLines(result.lines ?? []);

  // No geometry — degrade to a minimal flat-text scan. Most fields need the
  // spatial layout, so we only attempt the few that don't.
  if (placed.length === 0) {
    return {
      almazara: null,
      numeroTicket: null,
      fecha: fecha ?? null,
      kgAceituna: null,
      termino: null,
      poligono: null,
      parcela: null,
      recinto: null,
      calidad: null,
      variedad: null,
      lavada,
      horaInicio: times.inicio,
      horaFinal: times.final,
      duracion: times.duracion,
      rendimientoPct: null,
      precioUnitarioEur: null,
      totalEur: null,
      currency,
    };
  }

  // kg de aceituna: the "Total (Kg.)" cell — value is the big number below.
  const kgAceituna = resolveNumber(placed, [
    ['total', 'kg'],
    ['kg', 'aceituna'],
  ]);

  // Economic fields — only on liquidación tickets, usually absent here.
  const rendimientoPct = resolveNumber(placed, [['rendimiento'], ['rdto']]);
  const precioUnitarioEur = resolveNumber(placed, [
    ['precio', 'kg'],
    ['precio'],
  ]);
  let totalEur: number | null = null;
  for (const keywords of [['total', '€'], ['importe'], ['liquido']]) {
    const hit = findLabel(placed, keywords);
    if (hit) {
      totalEur = hit.inlineValue ?? valueForLabel(hit.line, placed);
      if (totalEur !== null) break;
    }
  }

  // String fields. Keyword fragments are chosen to survive common OCR
  // mangling ("Almazara"->"Aimazara", "Calidad"->"Callidad").
  return {
    almazara: cleanCode(resolveText(placed, [['mazara']])),
    numeroTicket: resolveText(placed, [['ticket']]),
    fecha: fecha ?? null,
    kgAceituna,
    termino: resolveText(placed, [['ermino']]),
    poligono: resolveText(placed, [['olig']]),
    parcela: resolveText(placed, [['arcela']]),
    recinto: resolveText(placed, [['ecinto']]),
    calidad: resolveText(placed, [['alidad'], ['alidd']]),
    variedad: resolveText(placed, [['ariedad']]),
    lavada,
    horaInicio: times.inicio,
    horaFinal: times.final,
    duracion: times.duracion,
    rendimientoPct:
      rendimientoPct !== null && rendimientoPct >= 0 && rendimientoPct <= 100
        ? rendimientoPct
        : null,
    precioUnitarioEur,
    totalEur,
    currency,
  };
}

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
