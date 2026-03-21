import { Request, Response, NextFunction } from 'express';

/**
 * Service authentication middleware.
 * Validates that incoming requests carry a valid service token.
 * The token is checked against SERVICE_AUTH_TOKEN env var.
 *
 * Accepts token via:
 *   - Authorization: Bearer <token>
 *   - X-Service-Token: <token>
 */
export function serviceAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env.SERVICE_AUTH_TOKEN;

  // If no token is configured, skip auth in non-production (backwards compatible)
  if (!expectedToken) {
    if (process.env.NODE_ENV === 'production') {
      res.status(500).json({
        success: false,
        message: 'Server configuration error',
      });
      return;
    }
    // In development/test without SERVICE_AUTH_TOKEN configured, allow requests through
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const serviceTokenHeader = req.headers['x-service-token'];

  const token =
    (typeof serviceTokenHeader === 'string' ? serviceTokenHeader : undefined) ||
    (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined);

  if (!token || token !== expectedToken) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
    return;
  }

  next();
}
