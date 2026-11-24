import { getSupabaseServiceClient } from '../../config';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors';
import { fincasService } from '../fincas/fincas.service';
import {
  Actividad,
  ActividadRow,
  CreateActividadInput,
  ListActividadesQuery,
  UpdateActividadInput,
} from './actividades.types';

const ACTIVIDAD_COLUMNS =
  'id, parcela_id, type, performed_at, description, cost_eur, photos, ' +
  'fitosanitario, campana_id, created_by, created_at, updated_at';

function toActividad(row: ActividadRow): Actividad {
  return {
    id: row.id,
    parcelaId: row.parcela_id,
    type: row.type,
    performedAt: row.performed_at,
    description: row.description,
    costEur: row.cost_eur === null ? null : Number(row.cost_eur),
    photos: row.photos ?? [],
    fitosanitario: row.fitosanitario ?? null,
    campanaId: row.campana_id ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Verify a campaña exists and belongs to `fincaId`. The DB column has no
 * cross-table CHECK, so this guard is the integrity boundary: it stops a
 * grower from tagging an activity with a campaña of a different finca. */
async function assertCampanaInFinca(
  campanaId: string,
  fincaId: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('campanas')
    .select('finca_id')
    .eq('id', campanaId)
    .single();
  if (error || !data) {
    throw new NotFoundError('Campana not found', 'CAMPANA_NOT_FOUND');
  }
  if ((data.finca_id as string) !== fincaId) {
    throw new BadRequestError(
      'La campaña no pertenece a la misma finca que la parcela',
      'CAMPANA_FINCA_MISMATCH',
    );
  }
}

interface ActividadWithFinca extends ActividadRow {
  parcelas: { finca_id: string };
}

async function getParcelaFincaId(parcelaId: string): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('parcelas')
    .select('finca_id')
    .eq('id', parcelaId)
    .single();
  if (error || !data) {
    throw new NotFoundError('Parcela not found', 'PARCELA_NOT_FOUND');
  }
  return data.finca_id as string;
}

async function loadWithFincaOrThrow(
  actividadId: string,
): Promise<ActividadWithFinca> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('actividades')
    .select(`${ACTIVIDAD_COLUMNS}, parcelas!inner(finca_id)`)
    .eq('id', actividadId)
    .single();
  if (error || !data) {
    throw new NotFoundError('Actividad not found', 'ACTIVIDAD_NOT_FOUND');
  }
  return data as unknown as ActividadWithFinca;
}

async function assertCanMutate(
  row: ActividadWithFinca,
  userId: string,
  action: 'edit' | 'delete',
): Promise<void> {
  const role = await fincasService.assertMember(row.parcelas.finca_id, userId);
  if (row.created_by !== userId && role !== 'owner') {
    throw new ForbiddenError(
      `Only the creator or a finca owner can ${action} this actividad`,
      'FORBIDDEN_ACTIVIDAD',
    );
  }
}

export const actividadesService = {
  async list(userId: string, q: ListActividadesQuery): Promise<Actividad[]> {
    const supabase = getSupabaseServiceClient();
    let parcelaIds: string[];

    if (q.parcelaId) {
      const fincaId = await getParcelaFincaId(q.parcelaId);
      await fincasService.assertMember(fincaId, userId);
      parcelaIds = [q.parcelaId];
    } else if (q.fincaId) {
      await fincasService.assertMember(q.fincaId, userId);
      const { data, error } = await supabase
        .from('parcelas')
        .select('id')
        .eq('finca_id', q.fincaId);
      if (error) throw error;
      parcelaIds = (data ?? []).map((row) => row.id as string);
      if (parcelaIds.length === 0) return [];
    } else {
      // The zod refine() guarantees one is set; defensive guard for TS.
      return [];
    }

    let query = supabase
      .from('actividades')
      .select(ACTIVIDAD_COLUMNS)
      .in('parcela_id', parcelaIds)
      .order('performed_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (q.from) query = query.gte('performed_at', q.from);
    if (q.to) query = query.lte('performed_at', q.to);
    if (q.type) query = query.eq('type', q.type);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => toActividad(row as unknown as ActividadRow));
  },

  async getById(actividadId: string, userId: string): Promise<Actividad> {
    const row = await loadWithFincaOrThrow(actividadId);
    await fincasService.assertMember(row.parcelas.finca_id, userId);
    return toActividad(row);
  },

  async create(userId: string, input: CreateActividadInput): Promise<Actividad> {
    const fincaId = await getParcelaFincaId(input.parcelaId);
    await fincasService.assertMember(fincaId, userId);

    if (input.campanaId !== undefined) {
      await assertCampanaInFinca(input.campanaId, fincaId);
    }

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('actividades')
      .insert({
        parcela_id: input.parcelaId,
        type: input.type,
        performed_at: input.performedAt,
        description: input.description ?? null,
        cost_eur: input.costEur ?? null,
        photos: input.photos,
        fitosanitario: input.fitosanitario ?? null,
        campana_id: input.campanaId ?? null,
        created_by: userId,
      })
      .select(ACTIVIDAD_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new Error('Failed to create actividad');
    }
    return toActividad(data as unknown as ActividadRow);
  },

  async update(
    actividadId: string,
    userId: string,
    input: UpdateActividadInput,
  ): Promise<Actividad> {
    const row = await loadWithFincaOrThrow(actividadId);
    await assertCanMutate(row, userId, 'edit');

    const patch: Record<string, unknown> = {};
    if (input.type !== undefined) patch['type'] = input.type;
    if (input.performedAt !== undefined) patch['performed_at'] = input.performedAt;
    if (input.description !== undefined) patch['description'] = input.description;
    if (input.costEur !== undefined) patch['cost_eur'] = input.costEur;
    if (input.photos !== undefined) patch['photos'] = input.photos;
    if (input.fitosanitario !== undefined)
      patch['fitosanitario'] = input.fitosanitario;
    if (input.campanaId !== undefined) {
      // A non-null campanaId must belong to the actividad's finca; null
      // simply unlinks it.
      if (input.campanaId !== null) {
        await assertCampanaInFinca(input.campanaId, row.parcelas.finca_id);
      }
      patch['campana_id'] = input.campanaId;
    }

    // Cross-field guard: the DB CHECK constraint will reject a row where
    // fitosanitario is non-null and type != tratamiento_fitosanitario, but
    // we surface a clean 400 here instead of leaking a Postgres error. The
    // resulting type is `input.type ?? row.type`; the resulting fitosanitario
    // is `input.fitosanitario ?? row.fitosanitario` (undefined = unchanged).
    const resultingType = (input.type ?? row.type) as string;
    const resultingFito =
      input.fitosanitario !== undefined
        ? input.fitosanitario
        : (row.fitosanitario ?? null);
    if (
      resultingFito !== null &&
      resultingType !== 'tratamiento_fitosanitario'
    ) {
      throw new BadRequestError(
        'Solo se puede registrar bloque fitosanitario cuando el tipo es tratamiento_fitosanitario',
        'FITOSANITARIO_TYPE_MISMATCH',
      );
    }

    if (Object.keys(patch).length === 0) {
      return toActividad(row);
    }

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('actividades')
      .update(patch)
      .eq('id', actividadId)
      .select(ACTIVIDAD_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new NotFoundError('Actividad not found', 'ACTIVIDAD_NOT_FOUND');
    }
    return toActividad(data as unknown as ActividadRow);
  },

  async remove(actividadId: string, userId: string): Promise<void> {
    const row = await loadWithFincaOrThrow(actividadId);
    await assertCanMutate(row, userId, 'delete');

    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from('actividades')
      .delete()
      .eq('id', actividadId);
    if (error) throw error;
  },
};
