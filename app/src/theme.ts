// Small design-token file. Keeping it flat (no library) until styling
// needs grow. All screens/components read from here so swapping to a
// themed provider later is a single-file change.
export const theme = {
  colors: {
    background: '#F6F7F4',
    surface: '#FFFFFF',
    text: '#1B1F1A',
    textMuted: '#5C6655',
    primary: '#4C7A34',
    primaryText: '#FFFFFF',
    border: '#D7DBD1',
    danger: '#B23B3B',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radius: {
    sm: 6,
    md: 12,
  },
} as const;

export type Theme = typeof theme;
