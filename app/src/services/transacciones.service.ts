import { api } from '@/services/api';

export type TransaccionKind = 'ingreso' | 'gasto';

export interface Transaccion {
  id: string;
  campanaId: string;
  kind: TransaccionKind;
  category: string;
  occurredAt: string;
  amountEur: number;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampanaSummary {
  campanaId: string;
  totalIngresos: number;
  totalGastos: number;
  balance: number;
  count: number;
}

export interface CreateTransaccionInput {
  campanaId: string;
  kind: TransaccionKind;
  category: string;
  occurredAt: string; // YYYY-MM-DD
  amountEur: number;
  description?: string;
}

export interface UpdateTransaccionInput {
  kind?: TransaccionKind;
  category?: string;
  occurredAt?: string;
  amountEur?: number;
  /** null clears the description; undefined leaves it. Mirrors backend
   * patch semantics so the form can express both "no change" and "clear". */
  description?: string | null;
}

export const transaccionesService = {
  listByCampana(campanaId: string): Promise<Transaccion[]> {
    return api.get<Transaccion[]>('/transacciones', { campanaId });
  },
  getById(id: string): Promise<Transaccion> {
    return api.get<Transaccion>(`/transacciones/${id}`);
  },
  // Writes opt into the offline queue (see api.ts). Pure JSON payloads
  // with no file attachments → safe to persist in AsyncStorage and replay
  // verbatim once the network's back.
  create(input: CreateTransaccionInput): Promise<Transaccion> {
    const kindLabel = input.kind === 'ingreso' ? 'ingreso' : 'gasto';
    return api.post<Transaccion>('/transacciones', input, {
      enqueueOnOffline: { label: `Crear ${kindLabel}` },
    });
  },
  update(id: string, input: UpdateTransaccionInput): Promise<Transaccion> {
    return api.patch<Transaccion>(`/transacciones/${id}`, input, {
      enqueueOnOffline: { label: 'Editar transacción' },
    });
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/transacciones/${id}`, {
      enqueueOnOffline: { label: 'Eliminar transacción' },
    });
  },
  summary(campanaId: string): Promise<CampanaSummary> {
    return api.get<CampanaSummary>(`/transacciones/summary/${campanaId}`);
  },
};
