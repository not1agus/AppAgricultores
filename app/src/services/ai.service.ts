import { api } from '@/services/api';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface ChatResponse {
  reply: string;
}

export const aiService = {
  chat(
    fincaId: string,
    message: string,
    history: ChatMessage[],
  ): Promise<ChatResponse> {
    return api.post<ChatResponse>('/ai/chat', { fincaId, message, history });
  },
};
