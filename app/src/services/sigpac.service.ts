import { api } from '@/services/api';

/**
 * SIGPAC reference fields are kept as strings (not numbers) so leading zeros
 * in Spanish cadastral codes (e.g. provincia "01") survive the round-trip.
 * This mirrors the Zod schema in backend/src/modules/sigpac/sigpac.types.ts.
 */
export interface SigpacReference {
  provincia: string;
  municipio: string;
  agregado?: string;
  zona?: string;
  poligono: string;
  parcela: string;
  recinto?: string;
}

export type SigpacGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface SigpacParcelResult {
  reference: SigpacReference;
  areaHa: number | null;
  geometry: SigpacGeometry;
}

const DIGITS_RE = /^\d+$/;

/** Form-state mirror of SigpacReference (every field a TextInput string). */
export interface SigpacForm {
  provincia: string;
  municipio: string;
  agregado: string;
  zona: string;
  poligono: string;
  parcela: string;
  recinto: string;
}

export const EMPTY_SIGPAC_FORM: SigpacForm = {
  provincia: '',
  municipio: '',
  agregado: '0',
  zona: '0',
  poligono: '',
  parcela: '',
  recinto: '',
};

/** Returns the reference or a Spanish error message for the form banner. */
export function buildSigpacReference(form: SigpacForm): SigpacReference | string {
  const required: Array<[keyof SigpacForm, string, number]> = [
    ['provincia', 'Provincia', 2],
    ['municipio', 'Municipio', 3],
    ['poligono', 'Polígono', 5],
    ['parcela', 'Parcela', 5],
  ];
  for (const [key, label, max] of required) {
    const v = form[key].trim();
    if (v.length === 0) return `Falta ${label}.`;
    if (!DIGITS_RE.test(v)) return `${label} sólo admite dígitos.`;
    if (v.length > max) return `${label} máximo ${max} dígitos.`;
  }
  for (const [key, label] of [['agregado', 'Agregado'], ['zona', 'Zona']] as const) {
    const v = form[key].trim();
    if (v.length > 0 && !DIGITS_RE.test(v)) return `${label} sólo admite dígitos.`;
  }
  const recinto = form.recinto.trim();
  if (recinto.length > 0) {
    if (!DIGITS_RE.test(recinto)) return 'Recinto sólo admite dígitos.';
    if (recinto.length > 5) return 'Recinto máximo 5 dígitos.';
  }
  const ref: SigpacReference = {
    provincia: form.provincia.trim(),
    municipio: form.municipio.trim(),
    agregado: form.agregado.trim() || '0',
    zona: form.zona.trim() || '0',
    poligono: form.poligono.trim(),
    parcela: form.parcela.trim(),
  };
  if (recinto.length > 0) ref.recinto = recinto;
  return ref;
}

export const sigpacService = {
  lookup(reference: SigpacReference): Promise<SigpacParcelResult> {
    return api.post<SigpacParcelResult>('/sigpac/lookup', reference);
  },
};
