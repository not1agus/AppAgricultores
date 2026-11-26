import { api } from '@/services/api';

export interface Campana {
  id: string;
  fincaId: string;
  name: string;
  startDate: string;
  /** null when the campaign is still open (no end date set yet). */
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampanaInput {
  fincaId: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  /** Optional — omit to create an open-ended campaign. */
  endDate?: string; // YYYY-MM-DD
}

export interface UpdateCampanaInput {
  name?: string;
  startDate?: string;
  /** null clears the end date (reopens the campaign); a string sets it. */
  endDate?: string | null;
}

export const campanasService = {
  listByFinca(fincaId: string): Promise<Campana[]> {
    return api.get<Campana[]>('/campanas', { fincaId });
  },
  getById(id: string): Promise<Campana> {
    return api.get<Campana>(`/campanas/${id}`);
  },
  create(input: CreateCampanaInput): Promise<Campana> {
    return api.post<Campana>('/campanas', input, {
      enqueueOnOffline: { label: `Crear campaña "${input.name}"` },
    });
  },
  update(id: string, input: UpdateCampanaInput): Promise<Campana> {
    return api.patch<Campana>(`/campanas/${id}`, input, {
      enqueueOnOffline: { label: 'Editar campaña' },
    });
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/campanas/${id}`, {
      enqueueOnOffline: { label: 'Eliminar campaña' },
    });
  },
};
