import { z } from 'zod';

export const userRoleSchema = z.enum(['superadmin', 'owner', 'worker']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userRecordSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: userRoleSchema,
  is_blocked: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type UserRecord = z.infer<typeof userRecordSchema>;

/**
 * Authenticated request context populated by requireAuth middleware.
 * This is the shape controllers see on req.user, not a DB row.
 */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  isBlocked: boolean;
}

export interface MeResponse {
  id: string;
  email: string;
  role: UserRole;
  isBlocked: boolean;
}
