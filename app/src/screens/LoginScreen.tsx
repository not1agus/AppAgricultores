import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { AuthStackParamList } from '@/navigation/types';
import { useAuthStore } from '@/store/useAuthStore';
import { theme } from '@/theme';
import { typography } from '@/typography';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

export function LoginScreen(): JSX.Element {
  const navigation = useNavigation<Nav>();
  const signIn = useAuthStore((s) => s.signIn);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    email.trim().length > 0 && password.length > 0 && !submitting;

  async function onSubmit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch {
      // Error already captured in the store.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.brandMark}>
          <Text style={styles.brandLetter}>O</Text>
        </View>
        <Text style={styles.title}>CampoLivo</Text>
        <Text style={styles.subtitle}>Cuaderno de campo y almazara</Text>
      </View>

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextField
        label="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        textContentType="password"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        title="Entrar"
        onPress={onSubmit}
        loading={submitting}
        disabled={!canSubmit}
      />

      <Pressable
        onPress={() => {
          clearError();
          navigation.navigate('SignUp');
        }}
        style={styles.signUpLink}
      >
        <Text style={styles.signUpText}>
          ¿Aún no tienes cuenta?{' '}
          <Text style={styles.signUpAction}>Crear una</Text>
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: theme.spacing.xl * 2,
    marginBottom: theme.spacing.xl,
    alignItems: 'center',
  },
  brandMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  brandLetter: {
    ...typography.display,
    fontSize: 32,
    fontWeight: '800',
    color: theme.colors.primaryText,
  },
  title: {
    ...typography.display,
    fontSize: 34,
    fontWeight: '800',
    color: theme.colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    ...typography.body,
    fontSize: 15,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
    textAlign: 'center',
  },
  error: {
    color: theme.colors.danger,
    marginBottom: theme.spacing.md,
  },
  signUpLink: {
    marginTop: theme.spacing.lg,
    alignItems: 'center',
  },
  signUpText: {
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  signUpAction: {
    color: theme.colors.primary,
    fontWeight: '600',
  },
});
