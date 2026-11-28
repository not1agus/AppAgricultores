import { Alert, Platform } from 'react-native';

// Cross-platform confirm dialog.
// ----------------------------------------------------------------------------
// React Native's Alert.alert renders multi-button dialogs natively on iOS and
// Android, but on react-native-web it falls through to window.alert(), which
// can only show a single OK button. That silently breaks every destructive
// confirmation in the app on the web build — the user taps "Eliminar" and
// nothing happens because the onPress of the "Eliminar" button was never
// wired to a real button on screen.
//
// This helper unifies the two surfaces. On native we keep Alert.alert with
// proper cancel/destructive styling. On web we delegate to window.confirm
// which gives the user a real OK/Cancel pair.
//
// Use this instead of Alert.alert WHEREVER you have more than one button.
// For info-only alerts (single OK), Alert.alert still works fine on both.

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label for the destructive/affirmative action. Default: "Aceptar". */
  confirmLabel?: string;
  /** Label for the cancel action. Default: "Cancelar". */
  cancelLabel?: string;
  /** When true (default), the confirm button uses destructive styling on
   * iOS (red). Pass false for non-destructive flows. */
  destructive?: boolean;
}

/** Returns a promise that resolves true if the user confirmed, false otherwise.
 *
 * We resolve (not reject) on cancel so call-sites can branch with a simple
 * `if (await confirmDestructive(...)) { ... }` instead of try/catch. */
export function confirmDestructive(opts: ConfirmOptions): Promise<boolean> {
  const {
    title,
    message,
    confirmLabel = 'Aceptar',
    cancelLabel = 'Cancelar',
    destructive = true,
  } = opts;

  if (Platform.OS === 'web') {
    // Browsers concatenate title + body with a newline. window.confirm is
    // synchronous; we wrap in a microtask-resolved promise so the API
    // matches the native side.
    const ok =
      typeof window !== 'undefined' &&
      typeof window.confirm === 'function' &&
      window.confirm(`${title}\n\n${message}`);
    return Promise.resolve(ok === true);
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      {
        text: cancelLabel,
        style: 'cancel',
        onPress: () => resolve(false),
      },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
