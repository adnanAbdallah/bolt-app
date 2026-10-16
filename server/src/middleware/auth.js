import { User } from '../models/User.js';
import { AUTH_COOKIE, clearAuthCookie, verifyAuthToken } from '../services/token.js';

/** Reads the JWT from the httpOnly cookie (or a Bearer header) and attaches req.user. */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = req.cookies?.[AUTH_COOKIE] || (header?.startsWith('Bearer ') && header.slice(7));
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  let payload;
  try {
    payload = verifyAuthToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  try {
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    // Checked on every request, so a ban takes effect immediately, not when the JWT expires.
    if (user.status === 'banned') {
      clearAuthCookie(res);
      return res.status(403).json({ error: 'Your account has been suspended', code: 'account_banned' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
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

/** Guard for every /api/admin route: signed in, active, and role === 'admin'. */
export const requireAdmin = [requireAuth, requireRole('admin')];
