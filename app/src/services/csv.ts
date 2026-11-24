// SDK 54: subpath `/legacy` para mantener cacheDirectory + EncodingType.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * Internal CSV helpers used by per-domain exporters (cuaderno, transacciones).
 * Conventions assume the consumer is a Spanish user opening the file in Excel:
 * - Separator `;` (Excel ES default — comma collides with decimal comma).
 * - CRLF terminators (RFC 4180, friendliest across Excel versions).
 * - BOM prepended at write-time so Excel detects UTF-8.
 * - Numeric formatting uses comma as decimal (es-ES convention).
 */

export function csvEscape(value: string): string {
  if (/[";\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvJoinRows(rows: string[][]): string {
  return rows.map((cells) => cells.map(csvEscape).join(';')).join('\r\n');
}

export function formatNumberEs(
  n: number | null,
  fractionDigits = 2,
): string {
  if (n === null) return '';
  return n
    .toLocaleString('es-ES', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      useGrouping: false,
    })
    .replace('.', ','); // belt-and-suspenders fallback if locale collapses
}

export function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

/**
 * Triggers a plain browser download of the CSV. Used on the web build,
 * where expo-file-system / expo-sharing have no implementation. Builds a
 * Blob and clicks a synthetic <a download> — the standard browser idiom.
 */
function downloadCsvWeb(fileName: string, csvBody: string): void {
  const blob = new Blob(['﻿' + csvBody], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Writes the CSV body and hands it to the user.
 *
 * - Native (iOS/Android): write to the cache dir, open the OS share sheet.
 * - Web: expo-file-system / expo-sharing aren't implemented, so we fall
 *   back to a direct browser download (Blob + <a download>).
 */
export async function shareCsv(
  fileName: string,
  csvBody: string,
  dialogTitle: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    downloadCsvWeb(fileName, csvBody);
    return;
  }

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Compartir no está disponible en este dispositivo.');
  }

  const body = '\uFEFF' + csvBody;
  const uri = `${FileSystem.cacheDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(uri, body, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  await Sharing.shareAsync(uri, {
    mimeType: 'text/csv',
    dialogTitle,
    UTI: 'public.comma-separated-values-text',
  });
}
