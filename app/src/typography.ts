import { TextStyle } from 'react-native';

import { theme } from './theme';

// Spread these into StyleSheet rules to apply the Terra-Modernist font tokens.
// Each fragment adds only fontFamily; size, weight and color stay with the caller.
export const typography = {
  display:    { fontFamily: theme.fontFamily.display    } satisfies TextStyle,
  headline:   { fontFamily: theme.fontFamily.headline   } satisfies TextStyle,
  body:       { fontFamily: theme.fontFamily.body       } satisfies TextStyle,
  bodyMedium: { fontFamily: theme.fontFamily.bodyMedium } satisfies TextStyle,
  label:      { fontFamily: theme.fontFamily.label      } satisfies TextStyle,
} as const;
