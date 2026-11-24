import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { AuthStackParamList } from '@/navigation/types';
import { useAuthStore } from '@/store/useAuthStore';
import { theme } from '@/theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export function SignUpScreen({ navigation }: Props): JSX.Element {
  const signUp = useAuthStore((s) => s.signUp);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // Shown after a successful sign-up if Supabase requires email confirmation
  // (no session is created). The store-driven `onAuthStateChange` would
  // otherwise just navigate us into the app.
  const [confirmationNotice, setConfirmationNotice] = useState(false);

  function validate(): string | null {
    if (!EMAIL_RE.test(email.trim())) return 'Email inválido.';
    if (password.length < MIN_PASSWORD)
      return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
    if (password !== confirmPassword) return 'Las contraseñas no coinciden.';
    return null;
  }

  async function onSubmit(): Promise<void> {
    const v = validate();
    if (v) {
      setLocalError(v);
      return;
    }
    setLocalError(null);
    setSubmitting(true);
    try {
      await signUp(email.trim(), password);
      // If a session was created automatically, the auth store has already
      // flipped to authenticated and the root navigator will swap stacks.
      // Otherwise show a "verify your email" notice.
      setConfirmationNotice(true);
    } catch {
      // Error already captured in the store.
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmationNotice) {
    return (
      <Screen>
        <View style={styles.header}>
          <Text style={styles.title}>Revisa tu email</Text>
          <Text style={styles.subtitle}>
            Te hemos enviado un enlace de confirmación a{' '}
            <Text style={styles.emailEmphasis}>{email.trim()}</Text>. Una vez
            verificada la cuenta podrás entrar.
          </Text>
        </View>
        <Button
          title="Volver al login"
          onPress={() => {
            clearError();
            navigation.navigate('Login');
          }}
        />
      </Screen>
    );
  }

  const message = localError ?? error;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Crear cuenta</Text>
        <Text style={styles.subtitle}>
          Olivar — gestión de finca para agricultores
        </Text>
      </View>

      <TextField
        label="Email"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setLocalError(null);
        }}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextField
        label="Contraseña (mínimo 8 caracteres)"
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          setLocalError(null);
        }}
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
      />
      <TextField
        label="Repite la contraseña"
        value={confirmPassword}
        onChangeText={(v) => {
          setConfirmPassword(v);
          setLocalError(null);
        }}
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
      />

      {message ? <Text style={styles.error}>{message}</Text> : null}

      <Button
        title="Crear cuenta"
        onPress={onSubmit}
        loading={submitting}
        disabled={submitting}
      />

      <Pressable
        onPress={() => {
          clearError();
          navigation.navigate('Login');
        }}
        style={styles.loginLink}
      >
        <Text style={styles.loginText}>
          ¿Ya tienes cuenta? <Text style={styles.loginAction}>Entrar</Text>
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  emailEmphasis: {
    color: theme.colors.text,
    fontWeight: '600',
  },
  error: {
    color: theme.colors.danger,
    marginBottom: theme.spacing.md,
  },
  loginLink: {
    marginTop: theme.spacing.lg,
    alignItems: 'center',
  },
  loginText: {
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  loginAction: {
    color: theme.colors.primary,
    fontWeight: '600',
  },
});
