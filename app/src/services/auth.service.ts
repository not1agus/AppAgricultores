import { api } from '@/services/api';
import { supabase } from '@/services/supabase';

export type UserRole = 'superadmin' | 'owner' | 'worker';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  isBlocked: boolean;
}

export const authService = {
  async signIn(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  },

  async signUp(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  },

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  /**
   * Invalidates the refresh tokens for ALL the user's sessions across every
   * device — useful when the user suspects their credentials may be
   * compromised. The local session is also cleared as a side effect, so
   * `onAuthStateChange` flips us back to the login stack automatically.
   */
  async signOutEverywhere(): Promise<void> {
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) throw error;
  },

  /**
   * Re-verifies the current password before applying a change. Supabase's
   * updateUser doesn't require the current password (a long-standing
   * footgun), so we verify by attempting a sign-in with the active email
   * and the supplied current password — succeeds silently and refreshes
   * the session, fails with a clear error if the user mistypes.
   *
   * The session is not disrupted: signInWithPassword on an already-signed-in
   * user just rotates tokens for the same identity. After the password
   * change succeeds, the new password is the one accepted on next sign-in.
   */
  async updatePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user.email;
    if (!email) {
      throw new Error('Sesión no disponible. Vuelve a iniciar sesión.');
    }
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (verifyErr) {
      throw new Error('La contraseña actual no es correcta.');
    }
    const { error: updateErr } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (updateErr) throw updateErr;
  },

  /** Fetches the authenticated user profile from the backend (role, block status). */
  me(): Promise<AuthUser> {
    return api.get<AuthUser>('/auth/me');
  },
};
