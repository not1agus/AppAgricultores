import { getSupabaseServiceClient } from '../../config';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../common/errors';
import {
  AuthUser,
  UserRecord,
  userRecordSchema,
} from './auth.types';

export const authService = {
  /**
   * Verifies a Supabase access token, loads the user's profile,
   * and rejects blocked users. Returns the request-scoped AuthUser.
   */
  async verifyAccessToken(token: string): Promise<AuthUser> {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedError('Invalid or expired token', 'INVALID_TOKEN');
    }

    const profile = await authService.getUserProfile(data.user.id);

    if (profile.is_blocked) {
      throw new ForbiddenError('User is blocked', 'USER_BLOCKED');
    }

    return {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      isBlocked: profile.is_blocked,
    };
  },

  async getUserProfile(userId: string): Promise<UserRecord> {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('users')
      .select('id, email, role, is_blocked, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundError('User profile not found', 'USER_NOT_FOUND');
    }
    return userRecordSchema.parse(data);
  },
};
