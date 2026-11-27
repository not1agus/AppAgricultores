import { NotFoundError } from '../../common/errors';
import type { Actividad } from '../actividades/actividades.types';
import { actividadesService } from '../actividades/actividades.service';
import { fincasService } from '../fincas/fincas.service';
import type { Parcela } from '../parcelas/parcelas.types';
import { parcelasService } from '../parcelas/parcelas.service';
import { buildCdeRows, CDE_COLUMNS, toCsv } from './cde.builder';
import type { CdePreview, CdePreviewInput } from './cde.types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

export interface CdeSource {
  fincaName: string;
  actividades: Actividad[];
  parcelas: Parcela[];
}

/**
 * Carga, desde la base de datos y con control de acceso, exactamente los
 * tratamientos pedidos. Si alguno no pertenece a la finca se rechaza la
 * petición entera en lugar de exportar un subconjunto en silencio.
 */
export async function loadCdeSource(
  userId: string,
  input: CdePreviewInput,
): Promise<CdeSource> {
  const [finca, parcelas, fitos] = await Promise.all([
    fincasService.getById(input.fincaId, userId),
    parcelasService.listByFinca(input.fincaId, userId),
    actividadesService.list(userId, {
      fincaId: input.fincaId,
      type: 'tratamiento_fitosanitario',
    }),
  ]);

  const wanted = new Set(input.actividadIds);
  const actividades = fitos.filter((a) => wanted.has(a.id));
  if (actividades.length !== wanted.size) {
    throw new NotFoundError(
      'Algún tratamiento no existe o no pertenece a esta finca',
      'CDE_ACTIVIDAD_NOT_FOUND',
    );
  }
  return { fincaName: finca.name, actividades, parcelas };
}

export const cdeService = {
  async preview(userId: string, input: CdePreviewInput): Promise<CdePreview> {
    const src = await loadCdeSource(userId, input);
    const today = todayIso();
    const { rows, problems } = buildCdeRows(src.actividades, src.parcelas, today);
    return {
      columns: CDE_COLUMNS,
      rows,
      problems,
      csv: problems.length === 0 ? toCsv(CDE_COLUMNS, rows) : null,
      fileName: `cde-tratamientos-${slugify(src.fincaName) || 'finca'}-${today}.csv`,
    };
  },
};
