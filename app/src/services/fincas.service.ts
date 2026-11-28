import { api } from '@/services/api';
import type { UserRole } from '@/services/auth.service';

export type MemberRole = Exclude<UserRole, 'superadmin'>;

export interface Finca {
  id: string;
  ownerId: string;
  name: string;
  role: MemberRole;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateFincaInput {
  name?: string;
}

export const fincasService = {
  list(): Promise<Finca[]> {
    return api.get<Finca[]>('/fincas');
  },
  getById(id: string): Promise<Finca> {
    return api.get<Finca>(`/fincas/${id}`);
  },
  create(name: string): Promise<Finca> {
    return api.post<Finca>('/fincas', { name });
  },
  update(id: string, input: UpdateFincaInput): Promise<Finca> {
    return api.patch<Finca>(`/fincas/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/fincas/${id}`);
  },
};
