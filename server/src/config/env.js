const required = ['MONGODB_URI', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const num = (v, fallback) => (v === undefined || v === '' ? fallback : Number(v));

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: num(process.env.PORT, 5001),
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
  serverUrl: process.env.SERVER_URL || 'http://localhost:5001',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  devLogin: process.env.ENABLE_DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production',
  // Drivers need approved license + insurance before they can go online.
  requireDriverVerification: process.env.REQUIRE_DRIVER_VERIFICATION !== 'false',
  // Dev only: seeded demo drivers drive around so the admin fleet map has something to show.
  simulateDemoFleet: process.env.SIMULATE_DEMO_FLEET === 'true' && process.env.NODE_ENV !== 'production',
  fare: {
    currency: process.env.FARE_CURRENCY || 'USD',
    base: num(process.env.FARE_BASE, 1.0),
    perKm: num(process.env.FARE_PER_KM, 0.45),
    perMin: num(process.env.FARE_PER_MIN, 0.08),
    minimum: num(process.env.FARE_MINIMUM, 2.0),
  },
};

export const googleEnabled = Boolean(env.google.clientId && env.google.clientSecret);
