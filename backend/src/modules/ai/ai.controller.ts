import { Request, Response } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import { chat } from './ai.service';
import { chatRequestSchema, ChatRequest } from './ai.types';

export const aiController = {
  async chat(req: Request, res: Response): Promise<void> {
    if (!env.GEMINI_API_KEY) {
      res.status(503).json({
        success: false,
        error: {
          code: 'AI_NOT_CONFIGURED',
          message: 'El asistente IA no está disponible. Configura GEMINI_API_KEY en el servidor.',
        },
      });
      return;
    }

    const body = chatRequestSchema.parse(req.body) as ChatRequest;
    const userId = req.user!.id;

    try {
      const result = await chat(userId, body.fincaId, body.message, body.history ?? []);
      res.json({ success: true, data: result });
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Wrap Gemini errors as a 502
      const msg = err instanceof Error ? err.message : 'Error del servicio IA';
      res.status(502).json({
        success: false,
        error: { code: 'AI_UPSTREAM_ERROR', message: msg },
      });
    }
  },
};
