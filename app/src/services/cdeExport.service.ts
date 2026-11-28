/**
 * Exportación al Cuaderno Digital de Explotación Agrícola (CDE).
 *
 * La validación y el CSV se generan en el backend (módulo `cde`) a partir de
 * los datos guardados: la app no construye ni completa ninguna fila. Si falta
 * cualquier dato obligatorio, el backend devuelve los problemas y `csv: null`.
 */
import { api } from '@/services/api';
import { shareCsv } from '@/services/csv';

export type CdeFixTarget = 'actividad' | 'parcela';

export interface CdeProblem {
  actividadId: string;
  parcelaId: string;
  parcelaName: string;
  fecha: string;
  producto: string | null;
  fixIn: CdeFixTarget;
  messages: string[];
}

export interface CdePreview {
  columns: string[];
  rows: string[][];
  problems: CdeProblem[];
  csv: string | null;
  fileName: string;
}

export const cdeExportService = {
  preview(fincaId: string, actividadIds: string[]): Promise<CdePreview> {
    return api.post<CdePreview>('/cde/preview', { fincaId, actividadIds });
  },

  review(fincaId: string, actividadIds: string[]): Promise<{ review: string }> {
    return api.post<{ review: string }>('/ai/review-cde', { fincaId, actividadIds });
  },

  async share(preview: CdePreview): Promise<void> {
    if (preview.csv === null || preview.problems.length > 0) {
      throw new Error('Hay datos obligatorios sin completar.');
    }
    await shareCsv(preview.fileName, preview.csv, 'Exportar al Cuaderno Digital (CDE)');
  },
};
