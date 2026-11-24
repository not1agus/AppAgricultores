import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Screen } from '@/components/Screen';
import type { MainStackParamList } from '@/navigation/types';
import { ChatMessage, aiService } from '@/services/ai.service';
import { theme } from '@/theme';

type Props = NativeStackScreenProps<MainStackParamList, 'AiAssistant'>;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  error?: boolean;
}

// ─── Suggested prompts ────────────────────────────────────────────────────────

const SUGGESTIONS = [
  '¿Cuándo puedo cosechar tras el último tratamiento?',
  '¿Qué campos son obligatorios en el CUE?',
  'Revisa mis registros fitosanitarios recientes',
  '¿Qué es el carnet ROPO y es obligatorio?',
];

// ─── Components ───────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }): JSX.Element {
  const isUser = msg.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowModel]}>
      {!isUser && (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>IA</Text>
        </View>
      )}
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleModel,
          msg.error && styles.bubbleError,
        ]}
      >
        <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextModel]}>
          {msg.text}
        </Text>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function AiAssistantScreen({ route }: Props): JSX.Element {
  const { fincaId, fincaName } = route.params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const historyForApi: ChatMessage[] = messages
    .filter((m) => !m.error)
    .map((m) => ({ role: m.role, text: m.text }));

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      const { reply } = await aiService.chat(fincaId, trimmed, historyForApi);
      const modelMsg: Message = {
        id: `m_${Date.now()}`,
        role: 'model',
        text: reply,
      };
      setMessages((prev) => [...prev, modelMsg]);
    } catch (err) {
      const errMsg: Message = {
        id: `e_${Date.now()}`,
        role: 'model',
        text:
          err instanceof Error && err.message
            ? `No pude responder: ${err.message}`
            : 'Error al conectar con el asistente. Comprueba tu conexión.',
        error: true,
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  const showSuggestions = messages.length === 0;

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        {/* Messages list */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MessageBubble msg={item} />}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            showSuggestions ? (
              <View style={styles.welcomeWrap}>
                <Text style={styles.welcomeTitle}>Asistente CampoLivo</Text>
                <Text style={styles.welcomeSub}>
                  Pregúntame sobre normativa fitosanitaria, el Cuaderno Digital
                  (CUE/SIEX) o tus datos de {fincaName}.
                </Text>
                <View style={styles.suggestionsWrap}>
                  {SUGGESTIONS.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => void send(s)}
                      style={styles.suggestionChip}
                    >
                      <Text style={styles.suggestionText}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null
          }
          ListFooterComponent={
            loading ? (
              <View style={styles.typingRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>IA</Text>
                </View>
                <View style={styles.typingBubble}>
                  <ActivityIndicator size="small" color={theme.colors.textMuted} />
                </View>
              </View>
            ) : null
          }
        />

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Escribe tu consulta..."
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={2000}
            editable={!loading}
            onSubmitEditing={() => void send(input)}
            returnKeyType="send"
          />
          <Pressable
            onPress={() => void send(input)}
            disabled={!input.trim() || loading}
            style={[
              styles.sendBtn,
              (!input.trim() || loading) && styles.sendBtnDisabled,
            ]}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },

  list: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    flexGrow: 1,
  },

  // Welcome / suggestions
  welcomeWrap: {
    marginBottom: theme.spacing.lg,
  },
  welcomeTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  welcomeSub: {
    fontSize: 14,
    color: theme.colors.textMuted,
    lineHeight: 20,
    marginBottom: theme.spacing.md,
  },
  suggestionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  suggestionChip: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    backgroundColor: theme.colors.primary + '12',
  },
  suggestionText: {
    fontSize: 13,
    color: theme.colors.primary,
    fontWeight: '500',
  },

  // Bubbles
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.sm,
    alignItems: 'flex-end',
  },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowModel: { justifyContent: 'flex-start' },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.xs,
    flexShrink: 0,
  },
  avatarText: { fontSize: 10, fontWeight: '800', color: theme.colors.primaryText },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  bubbleUser: {
    backgroundColor: theme.colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleModel: {
    backgroundColor: theme.colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  bubbleError: { borderColor: theme.colors.danger, borderWidth: 1 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextUser: { color: theme.colors.primaryText },
  bubbleTextModel: { color: theme.colors.text },

  // Typing indicator
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  typingBubble: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minWidth: 60,
    alignItems: 'center',
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    gap: theme.spacing.sm,
  },
  textInput: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 20,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.colors.text,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: {
    color: theme.colors.primaryText,
    fontSize: 20,
    fontWeight: '700',
    marginTop: -2,
  },
});
