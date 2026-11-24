import { z } from 'zod';

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'model']),
  text: z.string().min(1).max(4000),
});

export const chatRequestSchema = z
  .object({
    fincaId: z.string().uuid(),
    message: z.string().min(1).max(2000),
    history: z.array(chatMessageSchema).max(20).optional(),
  })
  .strict();

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ChatResponse {
  reply: string;
}
