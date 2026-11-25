import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { OfflineBadge } from '@/components/OfflineBadge';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import { authService } from '@/services/auth.service';
import { exportBackup } from '@/services/backup.service';
import {
  mutationQueue,
  QueuedMutation,
} from '@/services/mutationQueue.service';
import { useAuthStore } from '@/store/useAuthStore';
import { theme } from '@/theme';
import { typography } from '@/typography';
import { confirmDestructive } from '@/utils/confirm';

type Props = NativeStackScreenProps<MainStackParamList, 'Settings'>;

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadministrador',
  owner: 'Propietario',
  worker: 'Trabajador',
};

const MIN_PASSWORD_LENGTH = 8;

export function SettingsScreen(_props: Props): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const signOutEverywhere = useAuthStore((s) => s.signOutEverywhere);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [signingOut, setSigningOut] = useState(false);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);

  const [exportingBackup, setExportingBackup] = useState(false);
  const [backupStage, setBackupStage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  const [pending, setPending] = useState<QueuedMutation[]>([]);

  useEffect(() => mutationQueue.subscribe(setPending), []);

  async function handleExportBackup(): Promise<void> {
    if (exportingBackup || !user) return;
    setBackupError(null);
    setExportingBackup(true);
    setBackupStage('Preparando…');
    try {
      await exportBackup(user, (p) => {
        setBackupStage(p.stage);
      });
    } catch (err) {
      setBackupError(
        err instanceof Error ? err.message : 'No se pudo descargar el backup.',
      );
    } finally {
      setExportingBackup(false);
      setBackupStage(null);
    }
  }

  function resetPasswordForm(): void {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError(null);
  }

  function validatePassword(): string | null {
    if (currentPassword.length === 0)
      return 'Introduce tu contraseña actual.';
    if (newPassword.length < MIN_PASSWORD_LENGTH)
      return `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    if (newPassword === currentPassword)
      return 'La nueva contraseña debe ser distinta de la actual.';
    if (newPassword !== confirmPassword)
      return 'La confirmación no coincide.';
    return null;
  }

  async function handleSavePassword(): Promise<void> {
    const validationError = validatePassword();
    if (validationError) {
      setPasswordError(validationError);
      return;
    }
    setPasswordError(null);
    setPasswordSuccess(false);
    setSavingPassword(true);
    try {
      await authService.updatePassword(currentPassword, newPassword);
      setPasswordSuccess(true);
      resetPasswordForm();
      setShowPasswordForm(false);
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.',
      );
    } finally {
      setSavingPassword(false);
    }
  }

  async function confirmSignOut(): Promise<void> {
    if (signingOut) return;
    const ok = await confirmDestructive({
      title: 'Cerrar sesión',
      message: '¿Seguro que quieres cerrar sesión en este dispositivo?',
      confirmLabel: 'Cerrar sesión',
    });
    if (ok) {
      setSigningOut(true);
      void signOut();
    }
  }

  async function confirmSignOutEverywhere(): Promise<void> {
    if (signingOutEverywhere) return;
    const ok = await confirmDestructive({
      title: 'Cerrar sesión en todos los dispositivos',
      message:
        'Se cerrarán todas las sesiones activas, incluida esta. Tendrás que volver a iniciar sesión en cada dispositivo.',
      confirmLabel: 'Cerrar todas',
    });
    if (ok) {
      setSigningOutEverywhere(true);
      void signOutEverywhere();
    }
  }

  function fmtRelative(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return iso;
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return 'justo ahora';
    if (mins < 60) return `hace ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return `hace ${days} d`;
  }

  async function confirmRemovePending(entry: QueuedMutation): Promise<void> {
    const ok = await confirmDestructive({
      title: 'Descartar cambio',
      message: `Se eliminará "${entry.label}" de la cola. Esta acción no se puede deshacer y la operación nunca llegará al servidor.`,
      confirmLabel: 'Descartar',
    });
    if (ok) void mutationQueue.remove(entry.id);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Sincronización: only renders sections when there's something to
            show. The OfflineBadge handles the empty case (returns null).
            The per-entry list lives here (vs the home banner) because it's
            secondary information — most users will only ever see the badge. */}
        {pending.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Sincronización</Text>
            <OfflineBadge />
            <Card style={styles.section}>
              <Text style={styles.helper}>
                Estos cambios se guardaron sin conexión y aún no han llegado al
                servidor. Se reenvían automáticamente cuando recuperas internet.
              </Text>
              {pending.map((entry, idx) => {
                const blocked = entry.attempts >= 5;
                return (
                  <View
                    key={entry.id}
                    style={[
                      styles.pendingRow,
                      idx > 0 ? styles.pendingRowSep : null,
                    ]}
                  >
                    <View style={styles.pendingMain}>
                      <Text style={styles.pendingLabel}>{entry.label}</Text>
                      <Text style={styles.pendingMeta}>
                        {entry.method} · {fmtRelative(entry.createdAt)}
                        {entry.attempts > 0
                          ? ` · ${entry.attempts} intento${entry.attempts === 1 ? '' : 's'}`
                          : ''}
                      </Text>
                      {entry.lastError ? (
                        <Text style={styles.pendingError} numberOfLines={2}>
                          {entry.lastError}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.pendingActions}>
                      {blocked ? (
                        <Pressable
                          onPress={() => void mutationQueue.retry(entry.id)}
                          hitSlop={8}
                          style={styles.pendingBtn}
                        >
                          <Text style={styles.pendingBtnText}>Reintentar</Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={() => confirmRemovePending(entry)}
                        hitSlop={8}
                        style={styles.pendingBtn}
                      >
                        <Text style={styles.pendingBtnDangerText}>
                          Descartar
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Cuenta</Text>
        <Card style={styles.profileCard}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{user?.email ?? '—'}</Text>
          <View style={styles.profileSpacer} />
          <Text style={styles.label}>Rol</Text>
          <Text style={styles.value}>
            {user ? (ROLE_LABEL[user.role] ?? user.role) : '—'}
          </Text>
          {user?.isBlocked ? (
            // The backend already enforces blocking; this is a hint so the
            // user understands why their writes might fail. We don't sign
            // them out here — read access can still be useful.
            <Text style={styles.blockedNote}>
              Tu cuenta está bloqueada. Contacta con el administrador.
            </Text>
          ) : null}
        </Card>

        <Text style={styles.sectionTitle}>Seguridad</Text>
        <Card style={styles.section}>
          {!showPasswordForm ? (
            <>
              {passwordSuccess ? (
                <Text style={styles.success}>
                  Contraseña actualizada correctamente.
                </Text>
              ) : null}
              <Button
                title="Cambiar contraseña"
                variant="ghost"
                onPress={() => {
                  setPasswordSuccess(false);
                  setShowPasswordForm(true);
                }}
              />
            </>
          ) : (
            <View>
              <TextField
                label="Contraseña actual"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
              />
              <TextField
                label="Nueva contraseña"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
              />
              <TextField
                label="Repite la nueva contraseña"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
              />
              {passwordError ? (
                <Text style={styles.error}>{passwordError}</Text>
              ) : null}
              <View style={styles.formActions}>
                <Button
                  title="Cancelar"
                  variant="ghost"
                  onPress={() => {
                    resetPasswordForm();
                    setShowPasswordForm(false);
                  }}
                  disabled={savingPassword}
                />
                <View style={{ width: theme.spacing.sm }} />
                <Button
                  title="Guardar"
                  onPress={handleSavePassword}
                  loading={savingPassword}
                />
              </View>
            </View>
          )}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.helper}>
            Si crees que alguien más ha entrado en tu cuenta, cierra todas las
            sesiones para invalidar los accesos en otros dispositivos.
          </Text>
          <Button
            title="Cerrar sesión en todos los dispositivos"
            variant="ghost"
            onPress={confirmSignOutEverywhere}
            loading={signingOutEverywhere}
            disabled={signingOut || exportingBackup}
          />
        </Card>

        <Text style={styles.sectionTitle}>Datos</Text>
        <Card style={styles.section}>
          <Text style={styles.helper}>
            Descarga una copia completa de tus fincas, parcelas, campañas,
            actividades y tickets en un único archivo JSON. Las fotos se
            incluyen como enlaces (no se descargan).
          </Text>
          <Button
            title="Descargar mis datos"
            variant="ghost"
            onPress={handleExportBackup}
            loading={exportingBackup}
            disabled={signingOut || signingOutEverywhere}
          />
          {exportingBackup && backupStage ? (
            <Text style={styles.helper}>{backupStage}</Text>
          ) : null}
          {backupError ? (
            <Text style={styles.error}>{backupError}</Text>
          ) : null}
        </Card>

        <Text style={styles.sectionTitle}>Sesión</Text>
        <Card style={styles.section}>
          <Button
            title="Cerrar sesión"
            onPress={confirmSignOut}
            loading={signingOut}
            disabled={signingOutEverywhere || exportingBackup}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: theme.spacing.xl,
  },
  sectionTitle: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  profileCard: {
    marginBottom: theme.spacing.sm,
  },
  profileSpacer: {
    height: theme.spacing.sm,
  },
  label: {
    ...typography.label,
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: 2,
  },
  value: {
    ...typography.bodyMedium,
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  blockedNote: {
    color: theme.colors.danger,
    marginTop: theme.spacing.sm,
    fontSize: 13,
  },
  section: {
    marginBottom: theme.spacing.sm,
  },
  helper: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: theme.spacing.sm,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  error: {
    color: theme.colors.danger,
    marginBottom: theme.spacing.sm,
    fontSize: 13,
  },
  success: {
    color: theme.colors.primary,
    marginBottom: theme.spacing.sm,
    fontSize: 13,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  pendingRowSep: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  pendingMain: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  pendingLabel: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  pendingMeta: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  pendingError: {
    color: theme.colors.danger,
    fontSize: 12,
    marginTop: 2,
  },
  pendingActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pendingBtn: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    marginLeft: theme.spacing.xs,
  },
  pendingBtnText: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  pendingBtnDangerText: {
    color: theme.colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
});
