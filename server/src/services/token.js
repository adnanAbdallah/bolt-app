import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const AUTH_COOKIE = 'token';

export function signAuthToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

export function verifyAuthToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
}

/** OAuth `state`: a short-lived signed token carrying the role chosen on the login screen. */
export function signOAuthState(role) {
  return jwt.sign({ role, purpose: 'oauth_state' }, env.jwtSecret, { expiresIn: '10m' });
}

export function verifyOAuthState(state) {
  try {
    const payload = jwt.verify(state, env.jwtSecret);
    return payload.purpose === 'oauth_state' ? payload : null;
  } catch {
    return null;
  }
}
