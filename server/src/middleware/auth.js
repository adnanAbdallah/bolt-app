import { User } from '../models/User.js';
import { AUTH_COOKIE, verifyAuthToken } from '../services/token.js';

/** Reads the JWT from the httpOnly cookie (or a Bearer header) and attaches req.user. */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = req.cookies?.[AUTH_COOKIE] || (header?.startsWith('Bearer ') && header.slice(7));
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = verifyAuthToken(token);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
