import { z } from 'zod';

export const memberRoleSchema = z.enum(['owner', 'worker']);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const listMembersQuerySchema = z.object({
  fincaId: z.string().uuid(),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

/**
 * Owners add members by email, not by user_id — they don't know each other's
 * UUIDs. The invited user must already have signed up; otherwise the service
 * returns a clear error telling the owner to ask the worker to register first.
 */
export const addMemberSchema = z
  .object({
    fincaId: z.string().uuid(),
    email: z.string().trim().toLowerCase().email(),
    role: memberRoleSchema.default('worker'),
  })
  .strict();
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const memberFincaUserParamsSchema = z.object({
  fincaId: z.string().uuid(),
  userId: z.string().uuid(),
});
export type MemberFincaUserParams = z.infer<typeof memberFincaUserParamsSchema>;

export const updateMemberRoleSchema = z
  .object({
    role: memberRoleSchema,
  })
  .strict();
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export interface MemberRow {
  finca_id: string;
  user_id: string;
  role_in_finca: MemberRole;
  created_at: string;
  users: { email: string } | null;
}

export interface Member {
  fincaId: string;
  userId: string;
  email: string;
  role: MemberRole;
  createdAt: string;
}
