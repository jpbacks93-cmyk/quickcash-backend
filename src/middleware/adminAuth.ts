import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';

export interface AdminRequest extends Request {
  admin?: {
    role: string;
  };
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
    if (payload.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.admin = { role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}