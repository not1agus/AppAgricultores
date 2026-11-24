import { api } from '@/services/api';
import type {
  SigpacGeometry,
  SigpacReference,
} from '@/services/sigpac.service';

export interface GeoJsonPolygon {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface Parcela {
  id: string;
  fincaId: string;
  name: string;
  sigpacRef: SigpacReference | null;
  areaHa: number | null;
  geometry: GeoJsonPolygon | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateParcelaInput {
  fincaId: string;
  name: string;
  areaHa?: number;
  sigpacRef?: SigpacReference;
  geometry?: SigpacGeometry;
}

export interface CreateParcelaFromSigpacInput {
  fincaId: string;
  name: string;
  reference: SigpacReference;
}

export interface UpdateParcelaInput {
  name?: string;
  areaHa?: number | null;
  sigpacRef?: SigpacReference | null;
  geometry?: SigpacGeometry | null;
}

export const parcelasService = {
  listByFinca(fincaId: string): Promise<Parcela[]> {
    return api.get<Parcela[]>('/parcelas', { fincaId });
  },
  getById(id: string): Promise<Parcela> {
    return api.get<Parcela>(`/parcelas/${id}`);
  },
  create(input: CreateParcelaInput): Promise<Parcela> {
    return api.post<Parcela>('/parcelas', input);
  },
  createFromSigpac(input: CreateParcelaFromSigpacInput): Promise<Parcela> {
    return api.post<Parcela>('/parcelas/from-sigpac', input);
  },
  update(id: string, input: UpdateParcelaInput): Promise<Parcela> {
    return api.patch<Parcela>(`/parcelas/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/parcelas/${id}`);
  },
};
