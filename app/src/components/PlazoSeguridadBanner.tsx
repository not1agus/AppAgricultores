import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  PlazoStatus,
  formatPlazoDateEs,
} from '@/services/plazoSeguridad.service';
import { theme } from '@/theme';

// Yellow "no recolectar" warning banner for parcelas with an active plazo
// de seguridad. Sits at the top of ParcelaDetailScreen, right under the
// satellite map, so it's the first thing a user sees when they open a
// parcela mid-PHI.
//
// Colour choice: amber/yellow on a dark text. We don't add a `warning`
// token to the theme yet because this is the only surface using it; if a
// second consumer appears we'll promote it.

interface Props {
  /** When null we render nothing — the banner is opt-in based on whether
   * there's an active plazo to surface. */
  status: PlazoStatus | null;
  /** Optional tap handler — typically jumps to the actividad that imposed
   * the plazo so the user can verify the underlying record. */
  onPress?: (status: PlazoStatus) => void;
}

export function PlazoSeguridadBanner({ status, onPress }: Props): JSX.Element | null {
  if (!status) return null;

  // Use the inclusive day count: "faltan 0 días" reads weirdly, so on the
  // last day before expiry we say "vence mañana" / "vence hoy".
  const days = status.diasRestantes;
  const tail =
    days <= 0
      ? 'vence hoy'
      : days === 1
        ? 'vence mañana'
        : `faltan ${days} día${days === 1 ? '' : 's'}`;

  const body = (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>⚠</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>No recolectar · plazo de seguridad activo</Text>
        <Text style={styles.line}>
          Hasta el {formatPlazoDateEs(status.expiraEl)} ({tail}).
        </Text>
        <Text style={styles.meta}>
          Tratamiento: {status.productoComercial} · {status.performedAt}
        </Text>
      </View>
    </View>
  );

  if (!onPress) {
    return <View style={styles.banner}>{body}</View>;
  }

  return (
    <Pressable
      onPress={() => onPress(status)}
      style={({ pressed }) => [
        styles.banner,
        pressed ? styles.bannerPressed : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Plazo de seguridad activo hasta ${formatPlazoDateEs(status.expiraEl)}`}
    >
      {body}
    </Pressable>
  );
}

// Lightweight inline variant: a single-line chip for use inside another
// card or list item. No "tap to see" affordance — purely informational.
export function PlazoSeguridadChip({ status }: { status: PlazoStatus }): JSX.Element {
  const days = status.diasRestantes;
  const tail =
    days <= 0
      ? 'vence hoy'
      : days === 1
        ? 'vence mañana'
        : `${days}d`;
  return (
    <Text style={styles.chip} numberOfLines={1}>
      ⚠ Plazo seguridad: {formatPlazoDateEs(status.expiraEl)} · {tail}
    </Text>
  );
}

const WARN_BG = '#FEF6D8';
const WARN_BORDER = '#E0B84A';
const WARN_TEXT = '#5A4200';
const WARN_TEXT_MUTED = '#7A5C18';

const styles = StyleSheet.create({
  banner: {
    backgroundColor: WARN_BG,
    borderColor: WARN_BORDER,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  bannerPressed: {
    opacity: 0.85,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconWrap: {
    marginRight: theme.spacing.sm,
    marginTop: 1,
  },
  icon: {
    fontSize: 18,
    color: WARN_BORDER,
  },
  title: {
    color: WARN_TEXT,
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 2,
  },
  line: {
    color: WARN_TEXT,
    fontSize: 13,
    fontWeight: '600',
  },
  meta: {
    color: WARN_TEXT_MUTED,
    fontSize: 12,
    marginTop: 2,
  },
  chip: {
    backgroundColor: WARN_BG,
    borderColor: WARN_BORDER,
    borderWidth: 1,
    color: WARN_TEXT,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '600',
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
});
