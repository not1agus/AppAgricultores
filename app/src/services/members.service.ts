import { api } from '@/services/api';

export type MemberRole = 'owner' | 'worker';

export interface Member {
  fincaId: string;
  userId: string;
  email: string;
  role: MemberRole;
  createdAt: string;
}

export interface AddMemberInput {
  fincaId: string;
  email: string;
  role?: MemberRole;
}

export const membersService = {
  list(fincaId: string): Promise<Member[]> {
    return api.get<Member[]>('/members', { fincaId });
  },
  add(input: AddMemberInput): Promise<Member> {
    return api.post<Member>('/members', input);
  },
  updateRole(
    fincaId: string,
    userId: string,
    role: MemberRole,
  ): Promise<Member> {
    return api.patch<Member>(`/members/${fincaId}/${userId}`, { role });
  },
  remove(fincaId: string, userId: string): Promise<void> {
    return api.delete<void>(`/members/${fincaId}/${userId}`);
  },
};
