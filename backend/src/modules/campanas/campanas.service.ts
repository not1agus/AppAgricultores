import { getSupabaseServiceClient } from '../../config';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { fincasService } from '../fincas/fincas.service';
import {
  Campana,
  CampanaRow,
  CreateCampanaInput,
  ListCampanasQuery,
  UpdateCampanaInput,
} from './campanas.types';

const CAMPANA_COLUMNS =
  'id, finca_id, name, start_date, end_date, created_at, updated_at';

function toCampana(row: CampanaRow): Campana {
  return {
    id: row.id,
    fincaId: row.finca_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadOrThrow(campanaId: string): Promise<CampanaRow> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('campanas')
    .select(CAMPANA_COLUMNS)
    .eq('id', campanaId)
    .single();
  if (error || !data) {
    throw new NotFoundError('Campana not found', 'CAMPANA_NOT_FOUND');
  }
  return data as CampanaRow;
}

export const campanasService = {
  async list(userId: string, q: ListCampanasQuery): Promise<Campana[]> {
    await fincasService.assertMember(q.fincaId, userId);
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('campanas')
      .select(CAMPANA_COLUMNS)
      .eq('finca_id', q.fincaId)
      .order('start_date', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => toCampana(row as CampanaRow));
  },

  async getById(campanaId: string, userId: string): Promise<Campana> {
    const row = await loadOrThrow(campanaId);
    await fincasService.assertMember(row.finca_id, userId);
    return toCampana(row);
  },

  async create(userId: string, input: CreateCampanaInput): Promise<Campana> {
    await fincasService.assertOwner(input.fincaId, userId);

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('campanas')
      .insert({
        finca_id: input.fincaId,
        name: input.name,
        start_date: input.startDate,
        // Open-ended campaign when endDate is omitted by the caller.
        end_date: input.endDate ?? null,
      })
      .select(CAMPANA_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new Error('Failed to create campana');
    }
    return toCampana(data as CampanaRow);
  },

  async update(
    campanaId: string,
    userId: string,
    input: UpdateCampanaInput,
  ): Promise<Campana> {
    const row = await loadOrThrow(campanaId);
    await fincasService.assertOwner(row.finca_id, userId);

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch['name'] = input.name;
    if (input.startDate !== undefined) patch['start_date'] = input.startDate;
    if (input.endDate !== undefined) patch['end_date'] = input.endDate;

    if (Object.keys(patch).length === 0) {
      return toCampana(row);
    }

    const nextStart =
      (patch['start_date'] as string | undefined) ?? row.start_date;
    // end_date can be explicitly set to null (reopen the campaign). Only
    // validate ordering when the resulting end date is a real date.
    const nextEnd =
      'end_date' in patch
        ? (patch['end_date'] as string | null)
        : row.end_date;
    if (nextEnd !== null && nextEnd < nextStart) {
      throw new BadRequestError(
        'endDate must be on or after startDate',
        'INVALID_CAMPANA_PERIOD',
      );
    }

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('campanas')
      .update(patch)
      .eq('id', campanaId)
      .select(CAMPANA_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new NotFoundError('Campana not found', 'CAMPANA_NOT_FOUND');
    }
    return toCampana(data as CampanaRow);
  },

  async remove(campanaId: string, userId: string): Promise<void> {
    const row = await loadOrThrow(campanaId);
    await fincasService.assertOwner(row.finca_id, userId);

    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from('campanas').delete().eq('id', campanaId);
    if (error) throw error;
  },
};
