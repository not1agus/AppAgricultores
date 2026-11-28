// Terra-Modernist Design System — CampoLivo
// Colors rooted in the olive lifecycle: grove greens + terracotta earth.
// See DESIGN.md for the full spec.
export const theme = {
  colors: {
    // Backgrounds — surface hierarchy (stack like fine paper)
    background: '#fafaf5',         // base surface
    surfaceLow: '#f4f4ef',         // sectioning layer
    surface: '#ffffff',            // lifted cards / emphasis

    // Text
    text: '#1a1c19',               // on_surface (never pure black)
    textMuted: '#5C6655',

    // Primary — The Grove (olive green)
    primary: '#3e5219',
    primaryContainer: '#556b2f',
    primaryText: '#FFFFFF',

    // Secondary — The Earth (terracotta)
    secondary: '#934b19',
    secondaryText: '#FFFFFF',

    // Semantic
    danger: '#B23B3B',

    // Borders — ghost border at reduced opacity
    border: '#c5c8b8',
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },

  radius: {
    sm: 12,    // minimum per DESIGN.md (1rem)
    md: 20,    // cards/sections (1.5rem)
    lg: 28,    // large containers (2rem)
    pill: 999, // fully rounded buttons and chips
  },

  // Font family tokens — loaded via useFonts in App.tsx.
  // Falls back to system font until loaded.
  fontFamily: {
    display:     'PlusJakartaSans_700Bold',
    headline:    'PlusJakartaSans_600SemiBold',
    body:        'WorkSans_400Regular',
    bodyMedium:  'WorkSans_500Medium',
    label:       'WorkSans_500Medium',
  },
} as const;

export type Theme = typeof theme;
