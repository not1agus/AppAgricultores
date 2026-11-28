import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconCircle, IconName, IconTone } from '@/components/IconCircle';
import { theme } from '@/theme';
import { typography } from '@/typography';

/**
 * Fila pulsable: icono en círculo, título, línea secundaria, un elemento
 * opcional debajo (`below`, p. ej. un importe largo que no debe quitar sitio
 * al título) o a la derecha (`right`, algo corto), y el chevron.
 */
export function ListRow({
  icon,
  tone = 'primary',
  title,
  meta,
  below,
  right,
  onPress,
}: {
  icon: IconName;
  tone?: IconTone;
  title: string;
  meta?: string;
  below?: ReactNode;
  right?: ReactNode;
  onPress: () => void;
}): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <IconCircle name={icon} tone={tone} />
      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {below}
      </View>
      {right}
      <MaterialCommunityIcons name="chevron-right" size={22} color={theme.colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  pressed: { opacity: 0.75 },
  main: { flex: 1, minWidth: 0 },
  title: {
    ...typography.bodyMedium,
    color: theme.colors.text,
    fontSize: 15,
  },
  meta: {
    ...typography.body,
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
});
