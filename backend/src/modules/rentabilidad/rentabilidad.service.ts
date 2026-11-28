import { getSupabaseServiceClient } from '../../config';
import { fincasService } from '../fincas/fincas.service';
import { computeCampanaSummary } from '../transacciones/transacciones.calculator';
import {
  CampanaInfo,
  CampanaWithSummary,
  FincaRentabilidadStats,
} from './rentabilidad.types';

interface CampanaRow {
  id: string;
  finca_id: string;
  name: string;
  start_date: string;
  end_date: string | null;
}

interface TransaccionMinRow {
  campana_id: string;
  kind: 'ingreso' | 'gasto';
  amount_eur: string | number;
}

function toCampanaInfo(row: CampanaRow): CampanaInfo {
  return {
    id: row.id,
    fincaId: row.finca_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

export const rentabilidadService = {
  async getFincaStats(
    fincaId: string,
    userId: string,
  ): Promise<FincaRentabilidadStats> {
    await fincasService.assertMember(fincaId, userId);

    const supabase = getSupabaseServiceClient();

    const { data: campanaRows, error: campanaErr } = await supabase
      .from('campanas')
      .select('id, finca_id, name, start_date, end_date')
      .eq('finca_id', fincaId)
      .order('start_date', { ascending: false });

    if (campanaErr) throw campanaErr;

    const campanas = (campanaRows ?? []) as CampanaRow[];
    if (campanas.length === 0) {
      return { campanas: [], totalIngresos: 0, totalGastos: 0, balance: 0 };
    }

    const campanaIds = campanas.map((c) => c.id);

    const { data: txRows, error: txErr } = await supabase
      .from('transacciones')
      .select('campana_id, kind, amount_eur')
      .in('campana_id', campanaIds);

    if (txErr) throw txErr;

    // Group transacciones by campana_id
    const byId = new Map<string, TransaccionMinRow[]>();
    for (const campanaId of campanaIds) {
      byId.set(campanaId, []);
    }
    for (const row of (txRows ?? []) as TransaccionMinRow[]) {
      byId.get(row.campana_id)?.push(row);
    }

    let totalIngresos = 0;
    let totalGastos = 0;
    const result: CampanaWithSummary[] = [];

    for (const campana of campanas) {
      const rows = byId.get(campana.id) ?? [];
      const summary = computeCampanaSummary(campana.id, rows);
      totalIngresos += summary.totalIngresos;
      totalGastos += summary.totalGastos;
      result.push({ campana: toCampanaInfo(campana), summary });
    }

    return {
      campanas: result,
      totalIngresos,
      totalGastos,
      balance: totalIngresos - totalGastos,
    };
  },
};
