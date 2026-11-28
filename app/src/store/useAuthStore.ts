import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { authService, AuthUser } from '@/services/auth.service';
import { supabase } from '@/services/supabase';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: Status;
  session: Session | null;
  user: AuthUser | null;
  error: string | null;

  /** Initializes from persisted Supabase session and wires the auth listener. */
  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Clears the last auth error message; call from screens before retrying. */
  clearError: () => void;
}

let authListenerBound = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  user: null,
  error: null,

  async hydrate() {
    const { data } = await supabase.auth.getSession();
    if (!authListenerBound) {
      authListenerBound = true;
      supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) {
          set({ status: 'unauthenticated', session: null, user: null });
          return;
        }
        set({ session });
        void get().refreshProfile();
      });
    }
    if (!data.session) {
      set({ status: 'unauthenticated', session: null, user: null });
      return;
    }
    set({ session: data.session });
    await get().refreshProfile();
  },

  async signIn(email, password) {
    set({ error: null });
    try {
      await authService.signIn(email, password);
      // onAuthStateChange will fire and trigger refreshProfile().
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      set({ error: message });
      throw err;
    }
  },

  async signUp(email, password) {
    set({ error: null });
    try {
      await authService.signUp(email, password);
      // Supabase may or may not auto-login depending on email-confirmation
      // settings. If a session exists, onAuthStateChange handles it; otherwise
      // the screen tells the user to verify their email.
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-up failed';
      set({ error: message });
      throw err;
    }
  },

  clearError() {
    set({ error: null });
  },

  async signOut() {
    try {
      await authService.signOut();
    } finally {
      set({ status: 'unauthenticated', session: null, user: null });
    }
  },

  async signOutEverywhere() {
    try {
      await authService.signOutEverywhere();
    } finally {
      // Same local-state collapse as signOut — even if the global call
      // fails the user clearly intended to drop this device's session.
      set({ status: 'unauthenticated', session: null, user: null });
    }
  },

  async refreshProfile() {
    try {
      const user = await authService.me();
      set({ status: 'authenticated', user, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Profile fetch failed';
      set({ status: 'unauthenticated', user: null, error: message });
    }
  },
}));
