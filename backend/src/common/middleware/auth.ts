import { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors';
import { authService } from '../../modules/auth/auth.service';
import { AuthUser, UserRole } from '../../modules/auth/auth.types';

export type { AuthUser, UserRole };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      accessToken?: string;
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verifies the Authorization bearer token against Supabase,
 * loads the user's profile (including role and block status),
 * and attaches the request-scoped AuthUser to req.user.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new UnauthorizedError('Missing bearer token', 'MISSING_TOKEN');
    }
    const user = await authService.verifyAccessToken(token);
    req.user = user;
    req.accessToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Allows the request only if req.user.role is in the given list.
 * Must be placed after requireAuth in the middleware chain.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Not authenticated', 'NOT_AUTHENTICATED'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError('Insufficient permissions', 'FORBIDDEN_ROLE'));
      return;
    }
    next();
  };
}
