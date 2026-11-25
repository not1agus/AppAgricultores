import {
  cleanCode,
  extractNumber,
  isNumericLine,
  parseDate,
  parseEsNumber,
  parseLavada,
  parseSpanishDate,
  parseTicketFields,
  parseTimes,
  resolveNumber,
  resolveText,
  toPlacedLines,
  xOverlapRatio,
} from './tickets.parser';

// ---------- parseDate ---------------------------------------------------------

describe('parseDate', () => {
  it('parses ISO format YYYY-MM-DD', () => {
    expect(parseDate('Fecha: 2025-01-30')).toBe('2025-01-30');
  });

  it('parses slash ISO YYYY/MM/DD', () => {
    expect(parseDate('2025/3/5')).toBe('2025-03-05');
  });

  it('parses EU format DD/MM/YYYY', () => {
    expect(parseDate('30/01/2025')).toBe('2025-01-30');
  });

  it('parses EU format with dashes DD-MM-YYYY', () => {
    expect(parseDate('05-11-2026')).toBe('2026-11-05');
  });

  it('parses EU format with single-digit day and month (D/M/YYYY)', () => {
    // EU format: D/M/Y → 1/3/2026 = 1 March 2026
    expect(parseDate('1/3/2026')).toBe('2026-03-01');
  });

  it('returns null when no date is present', () => {
    expect(parseDate('Total: 249 kg')).toBeNull();
  });

  it('rejects an impossible month', () => {
    expect(parseDate('30/13/2025')).toBeNull();
  });

  it('rejects year before 2000', () => {
    expect(parseDate('01/01/1999')).toBeNull();
  });

  it('rejects year after 2100', () => {
    expect(parseDate('01/01/2101')).toBeNull();
  });
});

// ---------- parseEsNumber -----------------------------------------------------

describe('parseEsNumber', () => {
  it('parses plain integer', () => {
    expect(parseEsNumber('249')).toBe(249);
  });

  it('treats single dot as decimal separator (ambiguous — no comma present)', () => {
    // Without a comma, "1.234" is treated as 1.234 (decimal), not 1234.
    // The Spanish thousands format only triggers when BOTH dot and comma appear.
    expect(parseEsNumber('1.234')).toBe(1.234);
  });

  it('parses Spanish format with both dot-thousands and comma-decimal', () => {
    expect(parseEsNumber('1.234,56')).toBe(1234.56);
  });

  it('handles dot-only decimal like "0.75"', () => {
    expect(parseEsNumber('0.75')).toBe(0.75);
  });

  it('handles comma-only decimal like "0,75"', () => {
    expect(parseEsNumber('0,75')).toBe(0.75);
  });

  it('returns null for empty string', () => {
    expect(parseEsNumber('')).toBeNull();
  });

  it('returns null for non-numeric text', () => {
    expect(parseEsNumber('Almazara')).toBeNull();
  });

  it('detects decimal separator as the last separator', () => {
    // "1.234,56" → comma last → comma is decimal
    expect(parseEsNumber('1.234,56')).toBeCloseTo(1234.56);
    // "1,234.56" → dot last → dot is decimal
    expect(parseEsNumber('1,234.56')).toBeCloseTo(1234.56);
  });
});

// ---------- parseSpanishDate --------------------------------------------------

describe('parseSpanishDate', () => {
  it('parses "11 de marzo de 2026"', () => {
    expect(parseSpanishDate('11 de marzo de 2026')).toBe('2026-03-11');
  });

  it('parses "5 enero 2025" (without "de")', () => {
    expect(parseSpanishDate('5 enero 2025')).toBe('2025-01-05');
  });

  it('parses "diciembre" at end of year', () => {
    expect(parseSpanishDate('31 diciembre 2025')).toBe('2025-12-31');
  });

  it('handles alternate spelling "setiembre"', () => {
    expect(parseSpanishDate('15 setiembre 2026')).toBe('2026-09-15');
  });

  it('is case-insensitive', () => {
    expect(parseSpanishDate('10 ENERO 2025')).toBe('2025-01-10');
  });

  it('returns null when no Spanish month found', () => {
    expect(parseSpanishDate('2025-01-10')).toBeNull();
  });
});

// ---------- parseTimes --------------------------------------------------------

describe('parseTimes', () => {
  it('extracts two clock times and a duration', () => {
    const result = parseTimes('Inicio 08:30:00 Final 10:15:00 Duracion 00:45:00');
    expect(result.inicio).toBe('08:30:00');
    expect(result.final).toBe('10:15:00');
    expect(result.duracion).toBe('00:45:00');
  });

  it('sorts to pick earlier start and later end', () => {
    const result = parseTimes('10:15:00 08:30:00');
    expect(result.inicio).toBe('08:30:00');
    expect(result.final).toBe('10:15:00');
  });

  it('returns nulls when no times found', () => {
    const result = parseTimes('Solo texto sin horas');
    expect(result.inicio).toBeNull();
    expect(result.final).toBeNull();
    expect(result.duracion).toBeNull();
  });

  it('handles single clock time', () => {
    const result = parseTimes('08:30:00');
    expect(result.inicio).toBe('08:30:00');
    expect(result.final).toBeNull();
  });

  it('identifies "0:MM:SS" as duration', () => {
    const result = parseTimes('08:30:00 0:45:00 10:15:00');
    expect(result.duracion).toBe('0:45:00');
    expect(result.inicio).toBe('08:30:00');
    expect(result.final).toBe('10:15:00');
  });
});

// ---------- parseLavada -------------------------------------------------------

describe('parseLavada', () => {
  it('returns true for "Lavada: SI"', () => {
    expect(parseLavada('Lavada: SI')).toBe(true);
  });

  it('returns true for "Lavada: Sí" (accent)', () => {
    expect(parseLavada('Lavada: Sí')).toBe(true);
  });

  it('returns false for "Lavada: NO"', () => {
    expect(parseLavada('Lavada: NO')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(parseLavada('LAVADO: si')).toBe(true);
  });

  it('returns null when keyword absent', () => {
    expect(parseLavada('Total: 249 Kg')).toBeNull();
  });
});

// ---------- extractNumber -----------------------------------------------------

describe('extractNumber', () => {
  it('extracts a plain number from a cell', () => {
    expect(extractNumber('249')).toBe(249);
  });

  it('extracts the LAST number from "N.Ticket: 9.276" as decimal', () => {
    // "9.276" with only a dot → parsed as decimal 9.276 (not 9276).
    expect(extractNumber('N.Ticket: 9.276')).toBe(9.276);
  });

  it('returns null for a purely alphabetic string', () => {
    expect(extractNumber('SUELO')).toBeNull();
  });

  it('extracts from a string with trailing unit "249 Kg"', () => {
    expect(extractNumber('249 Kg')).toBe(249);
  });
});

// ---------- isNumericLine -----------------------------------------------------

describe('isNumericLine', () => {
  it('recognises a bare number', () => {
    expect(isNumericLine('249')).toBe(true);
  });

  it('recognises a number with Kg suffix', () => {
    expect(isNumericLine('1.234 Kg')).toBe(true);
  });

  it('recognises a percentage', () => {
    expect(isNumericLine('18 %')).toBe(true);
  });

  it('rejects a label line', () => {
    expect(isNumericLine('Total (Kg.)')).toBe(false);
  });

  it('rejects a date string', () => {
    expect(isNumericLine('2025-01-30')).toBe(false);
  });
});

// ---------- xOverlapRatio -----------------------------------------------------

describe('xOverlapRatio', () => {
  const makeLine = (x0: number, x1: number) => ({
    text: '', x0, y0: 0, x1, y1: 10, cx: (x0 + x1) / 2, cy: 5, h: 10,
  });

  it('returns 1 for identical ranges', () => {
    expect(xOverlapRatio(makeLine(0, 100), makeLine(0, 100))).toBe(1);
  });

  it('returns 0 for non-overlapping ranges', () => {
    expect(xOverlapRatio(makeLine(0, 50), makeLine(60, 100))).toBe(0);
  });

  it('returns 0.5 for half overlap over the narrower', () => {
    // narrower = 50px; overlap = 25px → 0.5
    const a = makeLine(0, 100);
    const b = makeLine(75, 125);
    expect(xOverlapRatio(a, b)).toBeCloseTo(0.5);
  });
});

// ---------- cleanCode ---------------------------------------------------------

describe('cleanCode', () => {
  it('restores a slash when OCR turned it into a letter', () => {
    expect(cleanCode('14A40094')).toBe('14/40094');
  });

  it('leaves a correctly-formatted code unchanged', () => {
    expect(cleanCode('14/40094')).toBe('14/40094');
  });

  it('returns null for null input', () => {
    expect(cleanCode(null)).toBeNull();
  });
});

// ---------- toPlacedLines / resolveNumber / resolveText ----------------------

describe('resolveNumber (spatial)', () => {
  it('finds a numeric value below a label', () => {
    const lines = [
      { text: 'Total (Kg.)', box: [10, 50, 150, 70] as [number,number,number,number] },
      { text: '249', box: [10, 80, 100, 100] as [number,number,number,number] },
    ];
    const placed = toPlacedLines(lines);
    const result = resolveNumber(placed, [['total', 'kg']]);
    expect(result).toBe(249);
  });

  it('returns null when no matching label exists', () => {
    const placed = toPlacedLines([
      { text: 'Almazara:', box: [0, 0, 100, 20] as [number,number,number,number] },
    ]);
    expect(resolveNumber(placed, [['total', 'kg']])).toBeNull();
  });

  it('extracts inline value from label text', () => {
    const placed = toPlacedLines([
      { text: 'Total kg: 180', box: [0, 0, 200, 20] as [number,number,number,number] },
    ]);
    expect(resolveNumber(placed, [['total', 'kg']])).toBe(180);
  });
});

describe('resolveText (spatial)', () => {
  it('extracts text after a colon inline', () => {
    const placed = toPlacedLines([
      { text: 'Almazara: Córdoba', box: [0, 0, 300, 20] as [number,number,number,number] },
    ]);
    expect(resolveText(placed, [['mazara']])).toBe('Córdoba');
  });
});

// ---------- parseTicketFields (integration) -----------------------------------

describe('parseTicketFields', () => {
  it('falls back gracefully with no lines (no geometry)', () => {
    const result = parseTicketFields({
      engine: 'tesseract',
      text: 'Almazara 14/40094\nFecha 30/01/2025\nTotal kg 249\nLavada: SI\n08:30:00 00:45:00 09:15:00',
      avgConfidence: 0.85,
      lines: [],
    });
    expect(result.fecha).toBe('2025-01-30');
    expect(result.lavada).toBe(true);
    expect(result.horaInicio).toBe('08:30:00');
    expect(result.duracion).toBe('00:45:00');
    // No geometry → kg not resolved
    expect(result.kgAceituna).toBeNull();
  });

  it('detects EUR currency', () => {
    const result = parseTicketFields({
      engine: 'tesseract',
      text: 'Total € 320,50',
      avgConfidence: null,
      lines: [],
    });
    expect(result.currency).toBe('EUR');
  });

  it('resolves kg from spatial layout', () => {
    const result = parseTicketFields({
      engine: 'paddleocr',
      text: 'Total (Kg.) 249',
      avgConfidence: 0.9,
      lines: [
        { text: 'Total (Kg.)', confidence: 90, box: [10, 50, 150, 70] },
        { text: '249',         confidence: 95, box: [10, 80, 100, 100] },
      ],
    });
    expect(result.kgAceituna).toBe(249);
  });

  it('limits rendimientoPct to 0-100 range', () => {
    // rendimiento > 100 should be rejected
    const result = parseTicketFields({
      engine: 'paddleocr',
      text: 'Rendimiento:',
      avgConfidence: null,
      lines: [
        { text: 'Rendimiento:', confidence: 90, box: [0, 0, 150, 20] },
        { text: '999',          confidence: 90, box: [0, 25, 100, 45] },
      ],
    });
    expect(result.rendimientoPct).toBeNull();
  });
});
