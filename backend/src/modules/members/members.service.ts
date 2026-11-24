import { getSupabaseServiceClient } from '../../config';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../common/errors';
import { fincasService } from '../fincas/fincas.service';
import {
  AddMemberInput,
  Member,
  MemberRole,
  MemberRow,
} from './members.types';

function toMember(row: MemberRow): Member {
  return {
    fincaId: row.finca_id,
    userId: row.user_id,
    // The join returns null if the user row was deleted while the membership
    // stayed — shouldn't happen because of the ON DELETE CASCADE, but guard
    // anyway so the UI can still render.
    email: row.users?.email ?? '(email no disponible)',
    role: row.role_in_finca,
    createdAt: row.created_at,
  };
}

async function getFincaOwnerId(fincaId: string): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('fincas')
    .select('owner_id')
    .eq('id', fincaId)
    .single();
  if (error || !data) {
    throw new NotFoundError('Finca not found', 'FINCA_NOT_FOUND');
  }
  return data.owner_id as string;
}

export const membersService = {
  async list(fincaId: string, userId: string): Promise<Member[]> {
    await fincasService.assertMember(fincaId, userId);
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('finca_members')
      .select(
        'finca_id, user_id, role_in_finca, created_at, users!inner(email)',
      )
      .eq('finca_id', fincaId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => toMember(row as unknown as MemberRow));
  },

  async add(userId: string, input: AddMemberInput): Promise<Member> {
    await fincasService.assertOwner(input.fincaId, userId);

    const supabase = getSupabaseServiceClient();
    const { data: targetUser, error: lookupErr } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', input.email)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!targetUser) {
      throw new NotFoundError(
        'No hay ningún usuario registrado con ese email. Pídele que se registre primero.',
        'USER_NOT_FOUND',
      );
    }

    // Idempotency: if they're already a member, surface a 409 so the UI can
    // show a clear message rather than silently swallowing the duplicate.
    const { data: existing } = await supabase
      .from('finca_members')
      .select('user_id')
      .eq('finca_id', input.fincaId)
      .eq('user_id', targetUser.id)
      .maybeSingle();
    if (existing) {
      throw new ConflictError(
        'Este usuario ya es miembro de la finca.',
        'ALREADY_MEMBER',
      );
    }

    const { data, error } = await supabase
      .from('finca_members')
      .insert({
        finca_id: input.fincaId,
        user_id: targetUser.id,
        role_in_finca: input.role,
      })
      .select(
        'finca_id, user_id, role_in_finca, created_at, users!inner(email)',
      )
      .single();
    if (error || !data) {
      throw error ?? new Error('Failed to add member');
    }
    return toMember(data as unknown as MemberRow);
  },

  async updateRole(
    fincaId: string,
    targetUserId: string,
    actingUserId: string,
    newRole: MemberRole,
  ): Promise<Member> {
    await fincasService.assertOwner(fincaId, actingUserId);

    // Can't demote the finca's canonical owner_id user — that would leave the
    // finca in a state where the owner_id doesn't match any owner membership,
    // which breaks several assumptions downstream.
    const fincaOwnerId = await getFincaOwnerId(fincaId);
    if (targetUserId === fincaOwnerId && newRole !== 'owner') {
      throw new BadRequestError(
        'No puedes degradar al dueño original de la finca.',
        'CANNOT_DEMOTE_OWNER',
      );
    }

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('finca_members')
      .update({ role_in_finca: newRole })
      .eq('finca_id', fincaId)
      .eq('user_id', targetUserId)
      .select(
        'finca_id, user_id, role_in_finca, created_at, users!inner(email)',
      )
      .single();
    if (error || !data) {
      throw new NotFoundError(
        'Membresía no encontrada.',
        'MEMBER_NOT_FOUND',
      );
    }
    return toMember(data as unknown as MemberRow);
  },

  async remove(
    fincaId: string,
    targetUserId: string,
    actingUserId: string,
  ): Promise<void> {
    await fincasService.assertOwner(fincaId, actingUserId);

    // Same protection: removing the canonical owner is forbidden. The
    // finca must be deleted (or ownership transferred) to get rid of them.
    const fincaOwnerId = await getFincaOwnerId(fincaId);
    if (targetUserId === fincaOwnerId) {
      throw new BadRequestError(
        'No puedes eliminar al dueño original de la finca.',
        'CANNOT_REMOVE_OWNER',
      );
    }

    const supabase = getSupabaseServiceClient();
    const { error, count } = await supabase
      .from('finca_members')
      .delete({ count: 'exact' })
      .eq('finca_id', fincaId)
      .eq('user_id', targetUserId);
    if (error) throw error;
    if (count === 0) {
      throw new NotFoundError('Membresía no encontrada.', 'MEMBER_NOT_FOUND');
    }
  },
};
