import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { IconName } from '@/components/IconCircle';
import { theme } from '@/theme';
import { typography } from '@/typography';

/** Título de sección con icono. `danger` para avisos que requieren atención. */
export function SectionTitle({
  icon,
  title,
  tone,
}: {
  icon: IconName;
  title: string;
  tone?: 'danger';
}): JSX.Element {
  const color = tone === 'danger' ? theme.colors.danger : theme.colors.textMuted;
  return (
    <View style={styles.row}>
      <MaterialCommunityIcons name={icon} size={16} color={color} />
      <Text style={[styles.title, { color }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: theme.spacing.sm,
  },
  title: {
    ...typography.headline,
    fontSize: 16,
  },
});
