import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env, googleEnabled } from './env.js';
import { User, SELF_ASSIGNABLE_ROLES } from '../models/User.js';
import { verifyOAuthState } from '../services/token.js';

/**
 * Find or create the user for a Google profile.
 * - New users get the role they chose on the login screen (passenger/driver only).
 * - Existing users keep their role; signing in via the "driver" button never changes it.
 * - Emails listed in ADMIN_EMAILS are always promoted to admin.
 */
export async function upsertGoogleUser({ googleId, email, name, avatar, requestedRole }) {
  const normalizedEmail = email.toLowerCase();
  const isAdmin = env.adminEmails.includes(normalizedEmail);

  let user = await User.findOne({ $or: [{ googleId }, { email: normalizedEmail }] });

  if (!user) {
    const role = isAdmin
      ? 'admin'
      : SELF_ASSIGNABLE_ROLES.includes(requestedRole)
        ? requestedRole
        : 'passenger';
    return User.create({ googleId, email: normalizedEmail, name, avatar, role });
  }

  user.googleId ??= googleId;
  user.name = name || user.name;
  user.avatar = avatar || user.avatar;
  if (isAdmin) user.role = 'admin';
  user.lastLoginAt = new Date();
  return user.save();
}

if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.google.clientId,
        clientSecret: env.google.clientSecret,
        callbackURL: `${env.serverUrl}/api/auth/google/callback`,
        passReqToCallback: true,
      },
      async (req, _accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(null, false, { message: 'google_no_email' });

          const state = verifyOAuthState(req.query.state);
          if (!state) return done(null, false, { message: 'invalid_state' });

          const user = await upsertGoogleUser({
            googleId: profile.id,
            email,
            name: profile.displayName,
            avatar: profile.photos?.[0]?.value,
            requestedRole: state.role,
          });
          done(null, user);
        } catch (err) {
          done(err);
        }
      },
    ),
  );
} else {
  console.warn('Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing).');
}

export default passport;
