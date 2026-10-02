import { Request, Response, NextFunction } from 'express';
import { verifyToken, UserTokenPayload, isUserToken } from '../lib/jwt';

export interface AuthRequest extends Request {
  user?: UserTokenPayload;
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  const token = header.slice(7);
  try {
    const payload = verifyToken(token);

    // Admin tokens can't access user routes
    if (!isUserToken(payload)) {
      return res.status(403).json({ error: 'User token required' });
    }

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}