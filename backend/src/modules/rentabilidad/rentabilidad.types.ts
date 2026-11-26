import { z } from 'zod';
import { CampanaSummary } from '../transacciones/transacciones.types';

export const fincaStatsParamsSchema = z.object({
  fincaId: z.string().uuid(),
});

export interface CampanaInfo {
  id: string;
  fincaId: string;
  name: string;
  startDate: string;
  endDate: string | null;
}

export interface CampanaWithSummary {
  campana: CampanaInfo;
  summary: CampanaSummary;
}

export interface FincaRentabilidadStats {
  campanas: CampanaWithSummary[];
  totalIngresos: number;
  totalGastos: number;
  balance: number;
}
