import {
  Content,
  EnhancedGenerateContentResponse,
  FinishReason,
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} from '@google/generative-ai';
import { getSupabaseServiceClient } from '../../config';
import { env } from '../../config/env';
import { logger } from '../../common/utils/logger';
import { fincasService } from '../fincas/fincas.service';
import { buildCdeRows } from '../cde/cde.builder';
import { loadCdeSource } from '../cde/cde.service';
import type { CdePreviewInput } from '../cde/cde.types';
import type { ChatMessage, ChatResponse, CdeReviewResponse } from './ai.types';

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `Eres un asistente especializado en agricultura mediterránea y normativa fitosanitaria española, integrado en la app CampoLivo para agricultores de olivar y otras explotaciones agrícolas de Andalucía.

## Tu rol
- Ayudas al agricultor a gestionar su explotación conforme a la normativa vigente.
- Revisas y validas los registros del cuaderno de campo (actividades fitosanitarias).
- Respondes en español, con un tono cercano y práctico.
- Si no sabes algo con certeza, lo dices claramente y recomiendas consultar un técnico agrícola.

## Normativa clave que debes conocer

### RD 1311/2012 — Uso sostenible de productos fitosanitarios
- Obliga a registrar todos los tratamientos fitosanitarios (art. 16 y anexo III, parte I.B).
- Datos de cada tratamiento (RD 1311/2012 anexo III parte I.B y Orden APA/204/2023 anexo II): fecha de tratamiento; identificación de la parcela (SIGPAC: provincia, municipio, agregado, zona, polígono, parcela, recinto); cultivo indicando especie y variedad; superficie tratada en hectáreas; problemática fitosanitaria (plaga a controlar) y justificación de la actuación; producto (nombre comercial, número de registro, materia activa); cantidad de producto utilizada (kg o L); aplicador (nombre y apellidos o razón social, NIF y nº de inscripción ROPO); equipo de aplicación (y nº ROMA cuando proceda); asesor, en su caso (nombre, NIF, código ROPO y fecha de validación); valoración de la eficacia; observaciones.
- El número de registro del producto (Registro de Productos Fitosanitarios del MAPA) no es lo mismo que el ROPO (registro de productores y operadores, donde se inscriben aplicadores y asesores).
- Los registros deben conservarse mínimo 3 años.

### Cuaderno Digital de Explotación Agrícola (RD 1054/2022, Orden APA/204/2023)
- Según el art. 16.1 del RD 1311/2012, el registro en papel solo se admite hasta el 31 de diciembre de 2026.
- Según el art. 16.5 del RD 1311/2012, los datos de los tratamientos deben proporcionarse al menos con carácter mensual.
- No afirmes otros plazos en días: si te preguntan, di que la norma consultada habla de "al menos con carácter mensual" y que conviene confirmarlo con la comunidad autónoma o un técnico.

### Plazo de seguridad
- Es el tiempo mínimo en días que debe pasar entre el último tratamiento y la cosecha.
- Si el plazo no ha terminado, NO se puede cosechar esa parcela.
- Ejemplo: tratamiento el 1 de octubre con plazo 21 días → no cosechar antes del 22 de octubre.

### Número de registro del producto
- Figura en la etiqueta del producto; para verificarlo hay que consultar el Registro de Productos Fitosanitarios del MAPA.

## Lo que puedes hacer
1. Responder preguntas sobre normativa fitosanitaria y el CUE.
2. Revisar tratamientos registrados y detectar campos vacíos u inconsistencias.
3. Calcular fechas: fin del plazo de seguridad, próxima anotación permitida, etc.
4. Sugerir qué información falta en un registro para cumplir el RD 1311/2012.
5. Recordar que los tratamientos deben volcarse al cuaderno digital al menos con carácter mensual.
6. Ayudar a interpretar datos de la explotación: producciones, gastos, etc.

## Lo que NO puedes hacer
- Dar consejo agronómico personalizado sin conocer el estado real del cultivo.
- Garantizar la validez de un número de registro de producto o de ROPO sin consultar el registro oficial.
- Reemplazar a un técnico agrícola cualificado.

## Formato de respuesta
- Responde de forma concisa y estructurada.
- Usa listas cuando haya varios puntos.
- Si detectas un problema en un registro, indícalo claramente con ⚠️.
- Si falta un campo obligatorio, indícalo con ❌.
- Si todo está correcto, usa ✅.
`;

// ─── Context builder ──────────────────────────────────────────────────────────

interface FarmContext {
  fincaName: string;
  parcelas: Array<{ name: string; sigpacRef: string | null; areaHa: number | null }>;
  activaCampana: string | null;
  recentTratamientos: Array<{
    fecha: string;
    parcela: string;
    producto: string;
    nroRegistro: string;
    materiaActiva: string | null;
    dosis: string;
    plaga: string;
    plazoSeguridadDias: number;
    finPlazo: string;
    operador: string | null;
    carnet: string | null;
  }>;
}

function isoToEs(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

type SigpacLike = {
  provincia: string | number;
  municipio: string | number;
  agregado?: string | number | null;
  zona?: string | number | null;
  poligono: string | number;
  parcela: string | number;
  recinto?: string | number | null;
};

function sigpacStr(ref: SigpacLike | null): string {
  if (!ref) return '(sin SIGPAC)';
  const part = (v: string | number | null | undefined) => (v == null || v === '' ? '?' : String(v));
  return [ref.provincia, ref.municipio, part(ref.agregado), part(ref.zona), ref.poligono, ref.parcela, part(ref.recinto)].join(':');
}

async function buildFarmContext(userId: string, fincaId: string): Promise<FarmContext> {
  const sb = getSupabaseServiceClient();

  // Same membership check as the rest of the API (throws if not a member).
  await fincasService.assertMember(fincaId, userId);

  const [fincaRes, parcelasRes, campanasRes] = await Promise.all([
    sb.from('fincas').select('name').eq('id', fincaId).single(),
    sb.from('parcelas').select('id, name, sigpac_ref, area_ha').eq('finca_id', fincaId),
    sb.from('campanas').select('name, end_date').eq('finca_id', fincaId).is('end_date', null).limit(1),
  ]);

  const parcelaMap = new Map(
    (parcelasRes.data ?? []).map((p) => [p.id as string, p]),
  );
  const parcelaIds = [...parcelaMap.keys()];

  // Last 90 days phytosanitary treatments
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const { data: actividades } = await sb
    .from('actividades')
    .select('performed_at, parcela_id, fitosanitario')
    .eq('type', 'tratamiento_fitosanitario')
    .in('parcela_id', parcelaIds.length > 0 ? parcelaIds : ['__none__'])
    .gte('performed_at', cutoff.toISOString().slice(0, 10))
    .order('performed_at', { ascending: false })
    .limit(20);

  type Fito = {
    productoComercial: string;
    numeroRegistro: string;
    materiaActiva?: string | null;
    dosis: number;
    dosisUnidad: string;
    plagaObjetivo: string;
    plazoSeguridadDias: number;
    operadorNombre?: string | null;
    operadorCarnet?: string | null;
  };

  const recentTratamientos = (actividades ?? []).map((a) => {
    const p = parcelaMap.get(a.parcela_id as string);
    const f = a.fitosanitario as Fito;
    return {
      fecha: isoToEs(a.performed_at as string),
      parcela: (p?.name as string) ?? '—',
      producto: f?.productoComercial ?? '—',
      nroRegistro: f?.numeroRegistro ?? '—',
      materiaActiva: (f?.materiaActiva as string | null) ?? null,
      dosis: f ? `${f.dosis} ${f.dosisUnidad}` : '—',
      plaga: f?.plagaObjetivo ?? '—',
      plazoSeguridadDias: f?.plazoSeguridadDias ?? 0,
      finPlazo: f ? addDays(a.performed_at as string, f.plazoSeguridadDias) : '—',
      operador: (f?.operadorNombre as string | null) ?? null,
      carnet: (f?.operadorCarnet as string | null) ?? null,
    };
  });

  return {
    fincaName: (fincaRes.data?.name as string) ?? fincaId,
    parcelas: (parcelasRes.data ?? []).map((p) => ({
      name: p.name as string,
      sigpacRef: sigpacStr((p.sigpac_ref as Parameters<typeof sigpacStr>[0]) ?? null),
      areaHa: p.area_ha as number | null,
    })),
    activaCampana: campanasRes.data?.[0]?.name as string | null ?? null,
    recentTratamientos,
  };
}

function contextToText(ctx: FarmContext): string {
  const lines: string[] = [
    `## Datos de la explotación del agricultor`,
    `**Nombre:** ${ctx.fincaName}`,
    `**Campaña activa:** ${ctx.activaCampana ?? '(ninguna)'}`,
    ``,
    `### Parcelas registradas (${ctx.parcelas.length}):`,
  ];

  for (const p of ctx.parcelas) {
    lines.push(
      `- ${p.name} · SIGPAC: ${p.sigpacRef ?? '—'} · Superficie: ${p.areaHa !== null ? `${p.areaHa} ha` : '—'}`,
    );
  }

  lines.push(``, `### Tratamientos fitosanitarios (últimos 90 días, ${ctx.recentTratamientos.length} registros):`);

  if (ctx.recentTratamientos.length === 0) {
    lines.push('(sin tratamientos registrados en los últimos 90 días)');
  } else {
    for (const t of ctx.recentTratamientos) {
      lines.push(
        `- ${t.fecha} | ${t.parcela} | ${t.producto} (nº ${t.nroRegistro})` +
        ` | ${t.dosis} | Plaga: ${t.plaga}` +
        ` | Plazo seg.: ${t.plazoSeguridadDias} días (fin: ${t.finPlazo})` +
        (t.operador ? ` | Operador: ${t.operador}${t.carnet ? ` (${t.carnet})` : ''}` : ' | ⚠️ Sin operador'),
      );
    }
  }

  return lines.join('\n');
}

// ─── Gemini client ────────────────────────────────────────────────────────────

// gemini-2.0/2.5-flash were retired by Google (404). gemini-3.8-flash and the
// *-latest aliases were timing out under load (Nov 2026); 3.5-flash answers
// reliably with this key. Keep a single model id here.
const GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_REQUEST = { timeout: 45_000 };
// Gemini 3.x "thinks" before answering and those thought tokens count against
// maxOutputTokens (~1.4k on a CDE review), so the budget must leave room for
// the visible answer too.
const GEMINI_MAX_OUTPUT_TOKENS = 8192;

/** Texto de la respuesta; si Gemini la cortó por límite, error en vez de media respuesta. */
function completeText(response: EnhancedGenerateContentResponse): string {
  if (response.candidates?.[0]?.finishReason === FinishReason.MAX_TOKENS) {
    throw new Error('La respuesta de la IA ha salido incompleta. Reintenta en unos minutos.');
  }
  return response.text();
}

function getClient(): GoogleGenerativeAI {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY no configurada');
  }
  return new GoogleGenerativeAI(env.GEMINI_API_KEY);
}

const SAFETY = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export async function chat(
  userId: string,
  fincaId: string,
  message: string,
  history: ChatMessage[],
): Promise<ChatResponse> {
  const ctx = await buildFarmContext(userId, fincaId);
  const contextBlock = contextToText(ctx);

  const client = getClient();
  const model = client.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION + '\n\n' + contextBlock,
    safetySettings: SAFETY,
    generationConfig: {
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      temperature: 0.4,
    },
  }, GEMINI_REQUEST);

  const geminiHistory: Content[] = history.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  const chatSession = model.startChat({ history: geminiHistory });

  let reply: string;
  try {
    const result = await chatSession.sendMessage(message);
    reply = completeText(result.response);
  } catch (err) {
    logger.warn('ai: Gemini call failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  return { reply };
}

// ─── Revisión de la exportación CDE ──────────────────────────────────────────

const CDE_REVIEW_INSTRUCTION = `Eres un revisor del registro de tratamientos fitosanitarios que un agricultor va a volcar al Cuaderno Digital de Explotación Agrícola (RD 1311/2012 anexo III parte I.B; Orden APA/204/2023 anexo II).

Reglas estrictas:
- Solo revisas. NUNCA propones valores concretos para rellenar datos que falten ni das por buenos datos inventados.
- Los campos vacíos obligatorios ya los detecta la app y te los pasan en "Problemas ya detectados": no los repitas.
- Busca incoherencias en los datos que sí hay: cantidad de producto que no cuadra con dosis × superficie tratada; superficie tratada vs. superficie de la parcela; plaga que no encaja con el producto o la materia activa; justificación genérica o vacía de contenido; valoración de eficacia ambigua; observaciones contradictorias; fechas raras (asesor validando después del tratamiento, tratamientos repetidos el mismo día en la misma parcela con el mismo producto).
- No puedes verificar números de registro ni ROPO: si hace falta, recomienda comprobarlos en el registro oficial.
- No afirmes plazos legales en días.

Formato: español, conciso, texto plano (la app no interpreta markdown: nada de **, # ni *; usa "- " para las listas). Una lista por tratamiento con problemas (identifícalo por fecha y referencia SIGPAC) usando ⚠️ para dudas y ❌ para errores claros. Si no ves nada raro en un tratamiento, no lo menciones. Termina con una línea "✅ Sin incoherencias detectadas" si no hay ninguna.`;

/**
 * Pide a Gemini una revisión de coherencia de los tratamientos a exportar.
 * Por privacidad no se envían NIF ni nombres de personas: el modelo solo
 * recibe datos agronómicos y si los datos de aplicador/asesor están presentes.
 */
export async function reviewCde(
  userId: string,
  input: CdePreviewInput,
): Promise<CdeReviewResponse> {
  const src = await loadCdeSource(userId, input);
  const { problems } = buildCdeRows(
    src.actividades,
    src.parcelas,
    new Date().toISOString().slice(0, 10),
  );
  const parcelasById = new Map(src.parcelas.map((p) => [p.id, p]));

  const tratamientos = src.actividades.map((a) => {
    const p = parcelasById.get(a.parcelaId);
    const f = a.fitosanitario;
    return {
      fecha: a.performedAt,
      sigpac: sigpacStr(p?.sigpacRef ?? null),
      superficieParcelaHa: p?.areaHa ?? null,
      cultivo: f?.cultivoEspecie ?? null,
      variedad: f?.cultivoVariedad ?? null,
      superficieTratadaHa: f?.superficieTratadaHa ?? null,
      plaga: f?.plagaObjetivo ?? null,
      justificacion: f?.justificacion ?? null,
      producto: f?.productoComercial ?? null,
      numeroRegistro: f?.numeroRegistro ?? null,
      materiaActiva: f?.materiaActiva ?? null,
      dosis: f ? `${f.dosis} ${f.dosisUnidad}` : null,
      volumenCaldoLHa: f?.volumenCaldoLHa ?? null,
      cantidad: f?.cantidadProducto != null ? `${f.cantidadProducto} ${f.cantidadUnidad ?? ''}`.trim() : null,
      equipo: f?.equipoDescripcion ?? null,
      aplicadorIdentificado: Boolean(f?.operadorNombre && f?.operadorNif && f?.operadorRopo),
      asesorFechaValidacion: f?.asesorFechaValidacion ?? null,
      eficacia: f?.eficacia ?? null,
      observaciones: a.description,
    };
  });

  const yaDetectados = problems.map(
    (pr) => `- ${pr.fecha} (${pr.parcelaName}): ${pr.messages.join('; ')}`,
  );

  const prompt = [
    `Tratamientos a revisar (${tratamientos.length}):`,
    JSON.stringify(tratamientos, null, 1),
    '',
    'Problemas ya detectados por la app:',
    yaDetectados.length > 0 ? yaDetectados.join('\n') : '(ninguno)',
  ].join('\n');

  const model = getClient().getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: CDE_REVIEW_INSTRUCTION,
    safetySettings: SAFETY,
    generationConfig: { maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS, temperature: 0.2 },
  }, GEMINI_REQUEST);

  try {
    const result = await model.generateContent(prompt);
    return { review: completeText(result.response) };
  } catch (err) {
    logger.warn('ai: Gemini CDE review failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
