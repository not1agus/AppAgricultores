import { getSupabaseServiceClient } from '../../config';
import { NotFoundError } from '../../common/errors';
import { fincasService } from '../fincas/fincas.service';
import { sigpacService } from '../sigpac/sigpac.service';
import {
  CreateParcelaFromSigpacInput,
  CreateParcelaInput,
  Parcela,
  ParcelaRow,
  UpdateParcelaInput,
} from './parcelas.types';

const PARCELA_COLUMNS =
  'id, finca_id, name, area_ha, sigpac_ref, geometry, created_at, updated_at';

function toParcela(row: ParcelaRow): Parcela {
  return {
    id: row.id,
    fincaId: row.finca_id,
    name: row.name,
    areaHa: row.area_ha === null ? null : Number(row.area_ha),
    sigpacRef: row.sigpac_ref,
    geometry: row.geometry,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadParcelaOrThrow(parcelaId: string): Promise<ParcelaRow> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('parcelas')
    .select(PARCELA_COLUMNS)
    .eq('id', parcelaId)
    .single();
  if (error || !data) {
    throw new NotFoundError('Parcela not found', 'PARCELA_NOT_FOUND');
  }
  return data as ParcelaRow;
}

export const parcelasService = {
  async listByFinca(fincaId: string, userId: string): Promise<Parcela[]> {
    await fincasService.assertMember(fincaId, userId);
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('parcelas')
      .select(PARCELA_COLUMNS)
      .eq('finca_id', fincaId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => toParcela(row as ParcelaRow));
  },

  async getById(parcelaId: string, userId: string): Promise<Parcela> {
    const row = await loadParcelaOrThrow(parcelaId);
    await fincasService.assertMember(row.finca_id, userId);
    return toParcela(row);
  },

  async create(userId: string, input: CreateParcelaInput): Promise<Parcela> {
    await fincasService.assertOwner(input.fincaId, userId);
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('parcelas')
      .insert({
        finca_id: input.fincaId,
        name: input.name,
        area_ha: input.areaHa ?? null,
        sigpac_ref: input.sigpacRef ?? null,
        geometry: input.geometry ?? null,
      })
      .select(PARCELA_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new Error('Failed to create parcela');
    }
    return toParcela(data as ParcelaRow);
  },

  async createFromSigpac(
    userId: string,
    input: CreateParcelaFromSigpacInput,
  ): Promise<Parcela> {
    await fincasService.assertOwner(input.fincaId, userId);
    const result = await sigpacService.fetchByReference(input.reference);
    return parcelasService.create(userId, {
      fincaId: input.fincaId,
      name: input.name,
      areaHa: result.areaHa ?? undefined,
      sigpacRef: result.reference,
      geometry: result.geometry,
    });
  },

  async update(
    parcelaId: string,
    userId: string,
    input: UpdateParcelaInput,
  ): Promise<Parcela> {
    const row = await loadParcelaOrThrow(parcelaId);
    await fincasService.assertOwner(row.finca_id, userId);

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch['name'] = input.name;
    if (input.areaHa !== undefined) patch['area_ha'] = input.areaHa;
    if (input.sigpacRef !== undefined) patch['sigpac_ref'] = input.sigpacRef;
    if (input.geometry !== undefined) patch['geometry'] = input.geometry;

    if (Object.keys(patch).length === 0) {
      return toParcela(row);
    }

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('parcelas')
      .update(patch)
      .eq('id', parcelaId)
      .select(PARCELA_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new NotFoundError('Parcela not found', 'PARCELA_NOT_FOUND');
    }
    return toParcela(data as ParcelaRow);
  },

  async remove(parcelaId: string, userId: string): Promise<void> {
    const row = await loadParcelaOrThrow(parcelaId);
    await fincasService.assertOwner(row.finca_id, userId);
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from('parcelas').delete().eq('id', parcelaId);
    if (error) throw error;
  },
};
