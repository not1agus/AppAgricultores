import { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, ViewStyle } from 'react-native';

import { theme } from '@/theme';

interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
}

export function Card({ children, onPress, style }: CardProps): JSX.Element {
  if (!onPress) {
    return <Pressable style={[styles.card, style]}>{children}</Pressable>;
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        pressed && styles.pressed,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

// DESIGN.md: cards use surface_container_lowest (#fff) on a surface base.
// Boundaries come from the background color shift, not from 1px borders.
// Ambient shadow: tinted with primary at 8% opacity (canopy light effect).
const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: theme.colors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 20,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  pressed: {
    opacity: 0.85,
  },
});
