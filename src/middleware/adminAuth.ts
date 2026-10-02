import { Request, Response, NextFunction } from 'express';
import { verifyToken, isAdminToken } from '../lib/jwt';

export interface AdminRequest extends Request {
  admin?: { role: 'ADMIN' };
}

export function requireAdmin(
  req: AdminRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing admin token' });
  }

  const token = header.slice(7);
  try {
    const payload = verifyToken(token);

    // User tokens can't access admin routes
    if (!isAdminToken(payload)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.admin = { role: 'ADMIN' };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}