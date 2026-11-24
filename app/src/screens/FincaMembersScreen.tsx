import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { MainStackParamList } from '@/navigation/types';
import { Member, MemberRole, membersService } from '@/services/members.service';
import { useAuthStore } from '@/store/useAuthStore';
import { theme } from '@/theme';
import { confirmDestructive } from '@/utils/confirm';

type Props = NativeStackScreenProps<MainStackParamList, 'FincaMembers'>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function FincaMembersScreen({ route }: Props): JSX.Element {
  const { fincaId } = route.params;
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add form state
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<MemberRole>('worker');
  const [adding, setAdding] = useState(false);

  // Row-level busy tracking so one row's spinner doesn't block the others.
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const me = useMemo(
    () => members.find((m) => m.userId === currentUserId) ?? null,
    [members, currentUserId],
  );
  const canManage = me?.role === 'owner';

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setMembers(await membersService.list(fincaId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando miembros');
    }
  }, [fincaId]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function onAdd(): Promise<void> {
    const email = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setError('Email inválido.');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const created = await membersService.add({
        fincaId,
        email,
        role: newRole,
      });
      setMembers((prev) => [...prev, created]);
      setNewEmail('');
      setNewRole('worker');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir');
    } finally {
      setAdding(false);
    }
  }

  async function toggleRole(member: Member): Promise<void> {
    if (busyUserId) return;
    const nextRole: MemberRole =
      member.role === 'owner' ? 'worker' : 'owner';
    setBusyUserId(member.userId);
    setError(null);
    try {
      const updated = await membersService.updateRole(
        fincaId,
        member.userId,
        nextRole,
      );
      setMembers((prev) =>
        prev.map((m) => (m.userId === updated.userId ? updated : m)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el rol');
    } finally {
      setBusyUserId(null);
    }
  }

  async function confirmRemove(member: Member): Promise<void> {
    const ok = await confirmDestructive({
      title: 'Quitar miembro',
      message: `¿Quitar a ${member.email} de la finca? Perderá el acceso inmediatamente.`,
      confirmLabel: 'Quitar',
    });
    if (ok) void doRemove(member);
  }

  async function doRemove(member: Member): Promise<void> {
    if (busyUserId) return;
    setBusyUserId(member.userId);
    setError(null);
    try {
      await membersService.remove(fincaId, member.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar');
    } finally {
      setBusyUserId(null);
    }
  }

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Miembros</Text>
      <Text style={styles.subtitle}>
        {canManage
          ? 'Añade trabajadores por email para que puedan acceder a esta finca.'
          : 'Sólo los dueños pueden gestionar miembros.'}
      </Text>

      {canManage ? (
        <Card style={styles.addCard}>
          <TextField
            label="Email del nuevo miembro"
            value={newEmail}
            onChangeText={(v) => {
              setNewEmail(v);
              setError(null);
            }}
            placeholder="correo@dominio.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <Text style={styles.label}>Rol</Text>
          <View style={styles.chipsRow}>
            {(['worker', 'owner'] as MemberRole[]).map((r) => {
              const selected = r === newRole;
              return (
                <Text
                  key={r}
                  onPress={() => setNewRole(r)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  {r === 'owner' ? 'Dueño' : 'Trabajador'}
                </Text>
              );
            })}
          </View>
          <Button
            title="Añadir"
            onPress={onAdd}
            loading={adding}
            disabled={adding}
          />
        </Card>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={members}
        keyExtractor={(m) => m.userId}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <Text style={styles.empty}>Aún no hay miembros.</Text>
        }
        renderItem={({ item }) => {
          const isSelf = item.userId === currentUserId;
          const rowBusy = busyUserId === item.userId;
          return (
            <Card>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.email}>
                    {item.email}
                    {isSelf ? ' (tú)' : ''}
                  </Text>
                  <Text style={styles.role}>
                    {item.role === 'owner' ? 'Dueño' : 'Trabajador'}
                  </Text>
                </View>
                {rowBusy ? (
                  <ActivityIndicator color={theme.colors.primary} />
                ) : null}
              </View>
              {canManage && !isSelf ? (
                <View style={styles.rowActions}>
                  <Button
                    title={item.role === 'owner' ? 'Pasar a trabajador' : 'Hacer dueño'}
                    variant="ghost"
                    onPress={() => void toggleRole(item)}
                    disabled={rowBusy}
                    style={styles.flex}
                  />
                  <View style={{ width: theme.spacing.sm }} />
                  <Button
                    title="Quitar"
                    variant="ghost"
                    onPress={() => confirmRemove(item)}
                    disabled={rowBusy}
                    style={styles.dangerBtn}
                  />
                </View>
              ) : null}
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
  },
  subtitle: {
    color: theme.colors.textMuted,
    marginTop: 2,
    marginBottom: theme.spacing.md,
  },
  addCard: { marginBottom: theme.spacing.md },
  label: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: theme.spacing.xs,
  },
  chipsRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.md,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    marginRight: theme.spacing.xs,
    fontSize: 13,
    overflow: 'hidden',
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    color: theme.colors.primaryText,
  },
  separator: { height: theme.spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  email: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
  },
  role: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: theme.spacing.xs,
  },
  rowActions: {
    flexDirection: 'row',
    marginTop: theme.spacing.sm,
  },
  flex: { flex: 1 },
  dangerBtn: {
    flex: 1,
    borderColor: theme.colors.danger,
  },
  empty: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
  error: {
    color: theme.colors.danger,
    marginBottom: theme.spacing.md,
  },
});
