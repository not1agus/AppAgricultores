/**
 * Pure OCR parsing helpers — no I/O, no side effects.
 * Extracted so they can be unit-tested independently of the full service.
 */

import { OcrEngineResponse, TicketFields } from './tickets.types';

// ---------- Date helpers -------------------------------------------------------

const DATE_REGEXES: RegExp[] = [
  /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/, // 2025-01-30 or 2025/1/30
  /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/, // 30/01/2025
];

export function parseDate(text: string): string | null {
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
export function parseEsNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasComma = trimmed.includes(',');
  const hasDot = trimmed.includes('.');
  let normalized: string;
  if (hasComma && hasDot) {
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

// ---------- Spanish month-name dates -------------------------------------------

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

export function parseSpanishDate(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [name, mo] of Object.entries(SPANISH_MONTHS)) {
    const idx = lower.indexOf(name);
    if (idx === -1) continue;
    const before = lower.slice(Math.max(0, idx - 14), idx);
    const dayMatch = /(\d{1,2})\D*$/.exec(before);
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

// ---------- Time helpers -------------------------------------------------------

export function parseTimes(text: string): {
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
export function parseLavada(text: string): boolean | null {
  const m = /lavad[ao]\s*:?\s*(s[ií]|no)/i.exec(text);
  if (!m) return null;
  return /^s/i.test(m[1]!);
}

/** OCR commonly turns "/" in an almazara code into a letter. */
export function cleanCode(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{1,4})\s*[a-zA-Z]\s*(\d{2,6})$/.exec(raw.trim());
  return m ? `${m[1]}/${m[2]}` : raw.trim();
}

// ---------- Spatial helpers ----------------------------------------------------

export interface PlacedLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  h: number;
}

export function toPlacedLines(
  lines: Array<{ text: string; box?: [number, number, number, number] }>,
): PlacedLine[] {
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

export function extractNumber(text: string): number | null {
  const matches = text.match(/\d[\d.,]*/g);
  if (!matches || matches.length === 0) return null;
  return parseEsNumber(matches[matches.length - 1]!);
}

export function isNumericLine(text: string): boolean {
  return /^[\s]*\d[\d.,\s]*(kg|%|€|l)?[\s]*$/i.test(text);
}

export function xOverlapRatio(a: PlacedLine, b: PlacedLine): number {
  const lo = Math.max(a.x0, b.x0);
  const hi = Math.min(a.x1, b.x1);
  const overlap = Math.max(0, hi - lo);
  const narrow = Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0));
  return overlap / narrow;
}

export function valueForLabel(
  label: PlacedLine,
  placed: PlacedLine[],
): number | null {
  let best: { score: number; value: number } | null = null;
  for (const cand of placed) {
    if (cand === label) continue;
    if (!isNumericLine(cand.text)) continue;
    const value = extractNumber(cand.text);
    if (value === null) continue;

    const sameRow =
      Math.abs(cand.cy - label.cy) < label.h * 0.8 && cand.x0 >= label.x0;
    if (sameRow) {
      const gap = Math.abs(cand.x0 - label.x1);
      const score = gap / 400;
      if (!best || score < best.score) best = { score, value };
      continue;
    }
    const below = cand.cy > label.cy && xOverlapRatio(label, cand) > 0.25;
    if (below) {
      const gap = cand.y0 - label.y1;
      if (gap > label.h * 6) continue;
      const score = Math.max(0, gap) / (label.h * 3);
      if (!best || score < best.score) best = { score, value };
    }
  }
  if (best && best.score < 1) return best.value;
  return null;
}

export function findLabel(
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

export function resolveNumber(
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

export function resolveText(
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

// ---------- Main entry point ---------------------------------------------------

export function parseTicketFields(result: OcrEngineResponse): TicketFields {
  const text = result.text;
  const fecha = parseDate(text) ?? parseSpanishDate(text);
  const currency = /€|eur/i.test(text) ? 'EUR' : null;
  const times = parseTimes(text);
  const lavada = parseLavada(text);

  const placed = toPlacedLines(result.lines ?? []);

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

  const kgAceituna = resolveNumber(placed, [
    ['total', 'kg'],
    ['kg', 'aceituna'],
    ['aceituna'],
  ]);

  const kgAceite = resolveNumber(placed, [
    ['kg', 'aceite'],
    ['aceite', 'kg'],
    ['litros', 'aceite'],
    ['aceite', 'litros'],
  ]);

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

  return {
    almazara: cleanCode(resolveText(placed, [['mazara']])),
    numeroTicket: resolveText(placed, [['ticket']]),
    fecha: fecha ?? null,
    kgAceituna,
    kgAceite: kgAceite !== null && kgAceite < (kgAceituna ?? Infinity) ? kgAceite : null,
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
