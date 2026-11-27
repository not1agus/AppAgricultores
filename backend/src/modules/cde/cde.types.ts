import { z } from 'zod';

export const cdePreviewSchema = z
  .object({
    fincaId: z.string().uuid(),
    actividadIds: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict();
export type CdePreviewInput = z.infer<typeof cdePreviewSchema>;

/** Dónde tiene que ir el usuario para corregir el problema. */
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
  columns: readonly string[];
  /** Una fila por tratamiento, solo con datos introducidos por el usuario. */
  rows: string[][];
  problems: CdeProblem[];
  /** CSV listo para compartir; null mientras quede algún problema. */
  csv: string | null;
  fileName: string;
}
