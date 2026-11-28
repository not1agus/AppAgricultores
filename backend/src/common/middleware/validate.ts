import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';

type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Parses and replaces req[target] with the validated payload.
 * Zod failures are forwarded to the central error handler.
 */
export function validate(schema: ZodSchema, target: ValidationTarget = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      next(result.error);
      return;
    }
    (req[target] as unknown) = result.data;
    next();
  };
}
