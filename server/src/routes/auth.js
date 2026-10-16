import { Router } from 'express';
import passport from '../config/passport.js';
import { env, googleEnabled } from '../config/env.js';
import { upsertGoogleUser } from '../config/passport.js';
import { SELF_ASSIGNABLE_ROLES } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { clearAuthCookie, setAuthCookie, signAuthToken, signOAuthState } from '../services/token.js';

const router = Router();

/** Where each role lands after login. Mirrored in the client router. */
export const homePathFor = (role) => ({ driver: '/driver', admin: '/admin' })[role] ?? '/ride';

router.get('/config', (_req, res) => {
  res.json({ googleEnabled, devLoginEnabled: env.devLogin });
});

// Step 1: /api/auth/google?role=driver  -> redirect to Google consent screen
router.get('/google', (req, res, next) => {
  if (!googleEnabled) return res.redirect(`${env.clientUrl}/login?error=google_not_configured`);
  const role = SELF_ASSIGNABLE_ROLES.includes(req.query.role) ? req.query.role : 'passenger';
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    prompt: 'select_account',
    state: signOAuthState(role),
  })(req, res, next);
});

// Step 2: Google redirects back here
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user, info) => {
    if (err || !user) {
      const reason = err ? 'server_error' : info?.message || 'auth_failed';
      return res.redirect(`${env.clientUrl}/login?error=${encodeURIComponent(reason)}`);
    }
    setAuthCookie(res, signAuthToken(user));
    res.redirect(`${env.clientUrl}${homePathFor(user.role)}`);
  })(req, res, next);
});

// Development-only shortcut so passenger + driver flows can be tested without Google credentials.
if (env.devLogin) {
  router.post(
    '/dev-login',
    asyncHandler(async (req, res) => {
      const { email, name, role } = req.body ?? {};
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Valid email required');
      const user = await upsertGoogleUser({
        googleId: `dev-${email.toLowerCase()}`,
        email,
        name: name || email.split('@')[0],
        requestedRole: role,
      });
      setAuthCookie(res, signAuthToken(user));
      res.json({ user: user.toPublicJSON(), redirectTo: homePathFor(user.role) });
    }),
  );
}

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublicJSON(), redirectTo: homePathFor(req.user.role) });
});

router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { phone, name, vehicle } = req.body ?? {};
    if (phone !== undefined) {
      if (phone && !/^\+?[0-9\s-]{7,20}$/.test(phone)) throw new HttpError(400, 'Invalid phone number');
      req.user.phone = phone || undefined;
    }
    if (name) req.user.name = String(name).slice(0, 80);
    if (vehicle && req.user.role === 'driver') {
      const { make, model, plate } = vehicle;
      req.user.vehicle = { make, model, plate };
    }
    await req.user.save();
    res.json({ user: req.user.toPublicJSON() });
  }),
);

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

export default router;
