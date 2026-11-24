import { getSupabaseServiceClient } from '../../config';
import { ForbiddenError, NotFoundError } from '../../common/errors';
import {
  CreateFincaInput,
  Finca,
  FincaRow,
  MemberRole,
  UpdateFincaInput,
} from './fincas.types';

const FINCA_COLUMNS = 'id, owner_id, name, created_at, updated_at';

function toFinca(row: FincaRow, role: MemberRole): Finca {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getMembership(
  fincaId: string,
  userId: string,
): Promise<MemberRole | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('finca_members')
    .select('role_in_finca')
    .eq('finca_id', fincaId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.role_in_finca as MemberRole | undefined) ?? null;
}

async function assertMember(fincaId: string, userId: string): Promise<MemberRole> {
  const role = await getMembership(fincaId, userId);
  if (!role) throw new NotFoundError('Finca not found', 'FINCA_NOT_FOUND');
  return role;
}

async function assertOwner(fincaId: string, userId: string): Promise<void> {
  const role = await assertMember(fincaId, userId);
  if (role !== 'owner') {
    throw new ForbiddenError('Not a finca owner', 'FORBIDDEN_FINCA');
  }
}

interface FincaWithMembership extends FincaRow {
  finca_members: Array<{ role_in_finca: MemberRole }>;
}

export const fincasService = {
  assertMember,
  assertOwner,

  async listForUser(userId: string): Promise<Finca[]> {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('fincas')
      .select(`${FINCA_COLUMNS}, finca_members!inner(role_in_finca)`)
      .eq('finca_members.user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((raw) => {
      const row = raw as FincaWithMembership;
      const role = row.finca_members[0]?.role_in_finca ?? 'worker';
      return toFinca(row, role);
    });
  },

  async getById(fincaId: string, userId: string): Promise<Finca> {
    const role = await assertMember(fincaId, userId);
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('fincas')
      .select(FINCA_COLUMNS)
      .eq('id', fincaId)
      .single();
    if (error || !data) {
      throw new NotFoundError('Finca not found', 'FINCA_NOT_FOUND');
    }
    return toFinca(data as FincaRow, role);
  },

  async create(userId: string, input: CreateFincaInput): Promise<Finca> {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.rpc('create_finca_with_owner', {
      p_owner_id: userId,
      p_name: input.name,
    });
    if (error || !data) {
      throw error ?? new Error('Failed to create finca');
    }
    return toFinca(data as FincaRow, 'owner');
  },

  async update(
    fincaId: string,
    userId: string,
    input: UpdateFincaInput,
  ): Promise<Finca> {
    await assertOwner(fincaId, userId);

    if (Object.keys(input).length === 0) {
      return fincasService.getById(fincaId, userId);
    }

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('fincas')
      .update({ name: input.name })
      .eq('id', fincaId)
      .select(FINCA_COLUMNS)
      .single();
    if (error || !data) {
      throw error ?? new NotFoundError('Finca not found', 'FINCA_NOT_FOUND');
    }
    return toFinca(data as FincaRow, 'owner');
  },

  async remove(fincaId: string, userId: string): Promise<void> {
    await assertOwner(fincaId, userId);
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from('fincas').delete().eq('id', fincaId);
    if (error) throw error;
  },
};
