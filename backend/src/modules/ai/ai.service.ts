import {
  Content,
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} from '@google/generative-ai';
import { getSupabaseServiceClient } from '../../config';
import { env } from '../../config/env';
import { ForbiddenError } from '../../common/errors';
import { logger } from '../../common/utils/logger';
import type { ChatMessage, ChatResponse } from './ai.types';

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `Eres un asistente especializado en agricultura mediterránea y normativa fitosanitaria española, integrado en la app CampoLivo para agricultores de olivar y otras explotaciones agrícolas de Andalucía.

## Tu rol
- Ayudas al agricultor a gestionar su explotación conforme a la normativa vigente.
- Revisas y validas los registros del cuaderno de campo (actividades fitosanitarias).
- Respondes en español, con un tono cercano y práctico.
- Si no sabes algo con certeza, lo dices claramente y recomiendas consultar un técnico agrícola.

## Normativa clave que debes conocer

### RD 1311/2012 — Uso sostenible de productos fitosanitarios
- Obliga a registrar todos los tratamientos fitosanitarios.
- Campos obligatorios: nombre del producto, nº de registro ROPO/MAPA, materia activa, dosis, unidad de dosis, plaga/enfermedad objetivo, plazo de seguridad en días, fecha de aplicación, parcela tratada, nombre y carnet del aplicador.
- El carnet de aplicador ROPO (Registro Oficial de Productores y Operadores) es obligatorio para aplicar fitosanitarios.
- Los registros deben conservarse mínimo 3 años.

### RD 1054/2022 — SIEX / Cuaderno Único de Explotación (CUE)
- Desde el 1 de enero de 2027 (Andalucía), todos los agricultores deben llevar el Cuaderno Único de Explotación digital.
- El CUE unifica el antiguo cuaderno fitosanitario con el cuaderno de campo general.
- Se gestiona a través de la plataforma digital de la Junta de Andalucía / MAPA.
- Campos adicionales del CUE: referencia SIGPAC de cada parcela, superficie tratada (ha), campaña agrícola.
- Las anotaciones deben realizarse dentro de los 3 días hábiles siguientes a la actividad.

### Plazo de seguridad
- Es el tiempo mínimo en días que debe pasar entre el último tratamiento y la cosecha.
- Si el plazo no ha terminado, NO se puede cosechar esa parcela.
- Ejemplo: tratamiento el 1 de octubre con plazo 21 días → no cosechar antes del 22 de octubre.

### Número de registro ROPO/MAPA
- Formato habitual: número de 5 dígitos (ej. 23339).
- Consulta el Registro de Productos Fitosanitarios del MAPA para verificar si un número es válido.

## Lo que puedes hacer
1. Responder preguntas sobre normativa fitosanitaria y el CUE.
2. Revisar tratamientos registrados y detectar campos vacíos u inconsistencias.
3. Calcular fechas: fin del plazo de seguridad, próxima anotación permitida, etc.
4. Sugerir qué información falta en un registro para cumplir el RD 1311/2012.
5. Explicar qué hacer si se supera el plazo de anotación (3 días hábiles).
6. Ayudar a interpretar datos de la explotación: producciones, gastos, etc.

## Lo que NO puedes hacer
- Dar consejo agronómico personalizado sin conocer el estado real del cultivo.
- Garantizar la validez de un número de registro ROPO sin consultar el MAPA.
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

function sigpacStr(ref: { provincia: number; municipio: number; poligono: number; parcela: number; recinto?: number | null } | null): string {
  if (!ref) return '(sin SIGPAC)';
  const tail = ref.recinto ? `:${ref.recinto}` : '';
  return `${ref.provincia}:${ref.municipio}:${ref.poligono}:${ref.parcela}${tail}`;
}

async function buildFarmContext(userId: string, fincaId: string): Promise<FarmContext> {
  const sb = getSupabaseServiceClient();

  // Verify user has access to the finca
  const { data: member } = await sb
    .from('finca_members')
    .select('role')
    .eq('finca_id', fincaId)
    .eq('user_id', userId)
    .single();
  if (!member) {
    throw new ForbiddenError('Acceso denegado a esta finca', 'FINCA_FORBIDDEN');
  }

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
    model: 'gemini-2.0-flash',
    systemInstruction: SYSTEM_INSTRUCTION + '\n\n' + contextBlock,
    safetySettings: SAFETY,
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.4,
    },
  });

  const geminiHistory: Content[] = history.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  const chatSession = model.startChat({ history: geminiHistory });

  let reply: string;
  try {
    const result = await chatSession.sendMessage(message);
    reply = result.response.text();
  } catch (err) {
    logger.warn('ai: Gemini call failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  return { reply };
}
