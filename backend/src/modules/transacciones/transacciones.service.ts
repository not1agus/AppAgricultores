import { getSupabaseServiceClient } from '../../config';
import { ForbiddenError, NotFoundError } from '../../common/errors';
import { fincasService } from '../fincas/fincas.service';
import {
  CampanaSummary,
  CreateTransaccionInput,
  ListTransaccionesQuery,
  Transaccion,
  TransaccionRow,
  UpdateTransaccionInput,
} from './transacciones.types';
import { computeCampanaSummary } from './transacciones.calculator';

const TRANSACCION_COLUMNS =
  'id, campana_id, kind, category, occurred_at, amount_eur, description, ' +
  'created_by, created_at, updated_at';

function toTransaccion(row: TransaccionRow): Transaccion {
  return {
    id: row.id,
    campanaId: row.campana_id,
    kind: row.kind,
    category: row.category,
    occurredAt: row.occurred_at,
    amountEur: Number(row.amount_eur),
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface TransaccionWithFinca extends TransaccionRow {
  campanas: { finca_id: string };
}

async function getCampanaFincaId(campanaId: string): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('campanas')
    .select('finca_id')
    .eq('id', campanaId)
    .single();
  if (error || !data) {
    throw new NotFoundError('Campana not found', 'CAMPANA_NOT_FOUND');
  }
  return data.finca_id as string;
}

async function loadWithFincaOrThrow(
  transaccionId: string,
): Promise<TransaccionWithFinca> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('transacciones')
    .select(`${TRANSACCION_COLUMNS}, campanas!inner(finca_id)`)
    .eq('id', transaccionId)
    .single();
  if (error || !data) {
    throw new NotFoundError('Transaccion not found', 'TRANSACCION_NOT_FOUND');
  }
  return data as unknown as TransaccionWithFinca;
}

async function assertCanMutate(
  row: TransaccionWithFinca,
  userId: string,
  action: 'edit' | 'delete',
): Promise<void> {
  const role = await fincasService.assertMember(row.campanas.finca_id, userId);
  if (row.created_by !== userId && role !== 'owner') {
    throw new ForbiddenError(
      `Only the creator or a finca owner can ${action} this transaccion`,
      'FORBIDDEN_TRANSACCION',
    );
  }
}

export const transaccionesService = {
  async list(
    userId: string,
    q: ListTransaccionesQuery,
  ): Promise<Transaccion[]> {
    const supabase = getSupabaseServiceClient();
    let campanaIds: string[];

    if (q.campanaId) {
      const fincaId = await getCampanaFincaId(q.campanaId);
      await fincasService.assertMember(fincaId, userId);
      campanaIds = [q.campanaId];
    } else if (q.fincaId) {
      await fincasService.assertMember(q.fincaId, userId);
      const { data, error } = await supabase
        .from('campanas')
        .select('id')
        .eq('finca_id', q.fincaId);
      if (error) throw error;
      campanaIds = (data ?? []).map((row) => row.id as string);
      if (campanaIds.length === 0) return [];
    } else {
      // The zod refine() guarantees one is set; defensive guard for TS.
      return [];
    }

    let query = supabase
      .from('transacciones')
      .select(TRANSACCION_COLUMNS)
      .in('campana_id', campanaIds)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (q.from) query = query.gte('occurred_at', q.from);
    if (q.to) query = query.lte('occurred_at', q.to);
    if (q.kind) query = query.eq('kind', q.kind);
    if (q.category) query = query.eq('category', q.category);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => toTransaccion(row as unknown as TransaccionRow));
  },

  async getById(transaccionId: string, userId: string): Promise<Transaccion> {
    const row = await loadWithFincaOrThrow(transaccionId);
    await fincasService.assertMember(row.campanas.finca_id, userId);
    return toTransaccion(row);
  },

  async create(
    userId: string,
    input: CreateTransaccionInput,
  ): Promise<Transaccion> {
    const fincaId = await getCampanaFincaId(input.campanaId);
    await fincasService.assertMember(fincaId, userId);

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('transacciones')
      .insert({
        campana_id: input.campanaId,
        kind: input.kind,
        category: input.category,
        occurred_at: input.occurredAt,
        amount_eur: input.amountEur,
        description: input.description ?? null,
        created_by: userId,
      })
      .select(TRANSACCION_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new Error('Failed to create transaccion');
    }
    return toTransaccion(data as unknown as TransaccionRow);
  },

  async update(
    transaccionId: string,
    userId: string,
    input: UpdateTransaccionInput,
  ): Promise<Transaccion> {
    const row = await loadWithFincaOrThrow(transaccionId);
    await assertCanMutate(row, userId, 'edit');

    const patch: Record<string, unknown> = {};
    if (input.kind !== undefined) patch['kind'] = input.kind;
    if (input.category !== undefined) patch['category'] = input.category;
    if (input.occurredAt !== undefined) patch['occurred_at'] = input.occurredAt;
    if (input.amountEur !== undefined) patch['amount_eur'] = input.amountEur;
    if (input.description !== undefined) patch['description'] = input.description;

    if (Object.keys(patch).length === 0) {
      return toTransaccion(row);
    }

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('transacciones')
      .update(patch)
      .eq('id', transaccionId)
      .select(TRANSACCION_COLUMNS)
      .single();
    if (error || !data) {
      throw (
        error ??
        new NotFoundError('Transaccion not found', 'TRANSACCION_NOT_FOUND')
      );
    }
    return toTransaccion(data as unknown as TransaccionRow);
  },

  async remove(transaccionId: string, userId: string): Promise<void> {
    const row = await loadWithFincaOrThrow(transaccionId);
    await assertCanMutate(row, userId, 'delete');

    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from('transacciones')
      .delete()
      .eq('id', transaccionId);
    if (error) throw error;
  },

  async summaryByCampana(
    campanaId: string,
    userId: string,
  ): Promise<CampanaSummary> {
    const fincaId = await getCampanaFincaId(campanaId);
    await fincasService.assertMember(fincaId, userId);

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('transacciones')
      .select('kind, amount_eur')
      .eq('campana_id', campanaId);
    if (error) throw error;

    return computeCampanaSummary(
      campanaId,
      (data ?? []) as Array<{ kind: 'ingreso' | 'gasto'; amount_eur: string | number }>,
    );
  },
};
