import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const EXPIRES_IN = '30d';

// Two token shapes: user tokens and admin tokens
export interface UserTokenPayload {
  userId: string;
  phone: string;
  role?: 'USER';
}

export interface AdminTokenPayload {
  role: 'ADMIN';
}

export type TokenPayload = UserTokenPayload | AdminTokenPayload;

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

// Type guard for user tokens
export function isUserToken(p: TokenPayload): p is UserTokenPayload {
  return (p as UserTokenPayload).userId !== undefined;
}

// Type guard for admin tokens
export function isAdminToken(p: TokenPayload): p is AdminTokenPayload {
  return (p as AdminTokenPayload).role === 'ADMIN';
}