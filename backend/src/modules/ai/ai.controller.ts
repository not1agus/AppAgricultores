import { Request, Response } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import type { CdePreviewInput } from '../cde/cde.types';
import { chat, reviewCde } from './ai.service';
import { chatRequestSchema, ChatRequest } from './ai.types';

function rejectIfNotConfigured(res: Response): boolean {
  if (env.GEMINI_API_KEY) return false;
  res.status(503).json({
    success: false,
    error: {
      code: 'AI_NOT_CONFIGURED',
      message: 'El asistente IA no está disponible. Configura GEMINI_API_KEY en el servidor.',
    },
  });
  return true;
}

async function respondWithGemini<T>(res: Response, run: () => Promise<T>): Promise<void> {
  try {
    const data = await run();
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const raw = err instanceof Error ? err.message : '';
    const msg = /503|high demand|overloaded/i.test(raw)
      ? 'La IA de Google está saturada ahora mismo. Reintenta en unos minutos.'
      : /abort|timeout/i.test(raw)
        ? 'La IA ha tardado demasiado en responder. Reintenta en unos minutos.'
        : raw || 'Error del servicio IA';
    res.status(502).json({
      success: false,
      error: { code: 'AI_UPSTREAM_ERROR', message: msg },
    });
  }
}

export const aiController = {
  async chat(req: Request, res: Response): Promise<void> {
    if (rejectIfNotConfigured(res)) return;
    const body = chatRequestSchema.parse(req.body) as ChatRequest;
    const userId = req.user!.id;
    await respondWithGemini(res, () =>
      chat(userId, body.fincaId, body.message, body.history ?? []),
    );
  },

  async reviewCde(req: Request, res: Response): Promise<void> {
    if (rejectIfNotConfigured(res)) return;
    const userId = req.user!.id;
    await respondWithGemini(res, () => reviewCde(userId, req.body as CdePreviewInput));
  },
};
