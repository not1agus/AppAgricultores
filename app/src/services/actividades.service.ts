import { api } from '@/services/api';

export type ActividadType =
  | 'tratamiento_fitosanitario'
  | 'riego'
  | 'poda'
  | 'cosecha'
  | 'abonado'
  | 'siembra'
  | 'laboreo'
  | 'otro';

export const ACTIVIDAD_TYPES: ActividadType[] = [
  'tratamiento_fitosanitario',
  'riego',
  'poda',
  'cosecha',
  'abonado',
  'siembra',
  'laboreo',
  'otro',
];

export const ACTIVIDAD_TYPE_LABELS: Record<ActividadType, string> = {
  tratamiento_fitosanitario: 'Tratamiento fitosanitario',
  riego: 'Riego',
  poda: 'Poda',
  cosecha: 'Cosecha',
  abonado: 'Abonado',
  siembra: 'Siembra',
  laboreo: 'Laboreo',
  otro: 'Otro',
};

// --- Cuaderno fitosanitario (RD 1311/2012) -----------------------------------
// Mirrors backend `fitosanitarioSchema`. Only attached to actividades whose
// type is 'tratamiento_fitosanitario'; null for everything else.
export type FitosanitarioDosisUnit = 'kg/ha' | 'L/ha' | 'kg/hL' | 'L/hL' | '%';

export const FITOSANITARIO_DOSIS_UNITS: FitosanitarioDosisUnit[] = [
  'kg/ha',
  'L/ha',
  'kg/hL',
  'L/hL',
  '%',
];

export interface Fitosanitario {
  productoComercial: string;
  numeroRegistro: string;
  materiaActiva?: string | null;
  dosis: number;
  dosisUnidad: FitosanitarioDosisUnit;
  plagaObjetivo: string;
  plazoSeguridadDias: number;
  volumenCaldoLHa?: number | null;
  operadorNombre?: string | null;
  operadorCarnet?: string | null;
}

export interface Actividad {
  id: string;
  parcelaId: string;
  type: ActividadType;
  performedAt: string;
  description: string | null;
  costEur: number | null;
  photos: string[];
  fitosanitario: Fitosanitario | null;
  /** Optional campaña this activity belongs to. null = not tagged. */
  campanaId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListActividadesQuery {
  fincaId?: string;
  parcelaId?: string;
  from?: string;
  to?: string;
  type?: ActividadType;
}

export interface CreateActividadInput {
  parcelaId: string;
  type: ActividadType;
  performedAt: string;
  description?: string;
  costEur?: number;
  photos?: string[];
  fitosanitario?: Fitosanitario;
  /** Optional campaña tag. Must belong to the same finca as the parcela. */
  campanaId?: string;
}

export interface UpdateActividadInput {
  type?: ActividadType;
  performedAt?: string;
  description?: string | null;
  costEur?: number | null;
  photos?: string[];
  // null clears the block; undefined leaves it unchanged.
  fitosanitario?: Fitosanitario | null;
  // null unlinks the campaña; a string links/relinks it.
  campanaId?: string | null;
}

function toQueryRecord(q: ListActividadesQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (q.fincaId) out['fincaId'] = q.fincaId;
  if (q.parcelaId) out['parcelaId'] = q.parcelaId;
  if (q.from) out['from'] = q.from;
  if (q.to) out['to'] = q.to;
  if (q.type) out['type'] = q.type;
  return out;
}

export const actividadesService = {
  list(query: ListActividadesQuery): Promise<Actividad[]> {
    return api.get<Actividad[]>('/actividades', toQueryRecord(query));
  },
  getById(id: string): Promise<Actividad> {
    return api.get<Actividad>(`/actividades/${id}`);
  },
  // Writes opt into the offline queue. The label is what the user sees
  // in the offline panel — keep it short, action+context. Photos must
  // already be uploaded to Storage by this point: their URLs travel
  // inside `input.photos`, so the queued payload is just JSON and survives
  // an app restart cleanly.
  create(input: CreateActividadInput): Promise<Actividad> {
    const typeLabel = ACTIVIDAD_TYPE_LABELS[input.type] ?? 'Actividad';
    return api.post<Actividad>('/actividades', input, {
      enqueueOnOffline: { label: `Crear ${typeLabel.toLowerCase()}` },
    });
  },
  update(id: string, input: UpdateActividadInput): Promise<Actividad> {
    return api.patch<Actividad>(`/actividades/${id}`, input, {
      enqueueOnOffline: { label: 'Editar actividad' },
    });
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/actividades/${id}`, {
      enqueueOnOffline: { label: 'Eliminar actividad' },
    });
  },
};
