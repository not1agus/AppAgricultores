import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '@/theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
export type IconTone = 'primary' | 'danger' | 'warning' | 'onDark';

// Tonal tints (DESIGN.md: depth through color shifts, never 1px lines).
const TONES: Record<IconTone, { bg: string; fg: string }> = {
  primary: { bg: 'rgba(62, 82, 25, 0.10)', fg: theme.colors.primary },
  danger: { bg: 'rgba(178, 59, 59, 0.10)', fg: theme.colors.danger },
  warning: { bg: 'rgba(224, 184, 74, 0.25)', fg: '#5A4200' },
  onDark: { bg: 'rgba(255, 255, 255, 0.16)', fg: theme.colors.primaryText },
};

/** Icono dentro de un círculo de tono suave. */
export function IconCircle({
  name,
  tone = 'primary',
  size = 40,
}: {
  name: IconName;
  tone?: IconTone;
  size?: number;
}): JSX.Element {
  const t = TONES[tone];
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, backgroundColor: t.bg },
      ]}
    >
      <MaterialCommunityIcons name={name} size={Math.round(size / 2)} color={t.fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
