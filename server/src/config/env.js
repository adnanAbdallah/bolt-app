const required = ['MONGODB_URI', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

function parseLatLng(v) {
  const [lat, lng] = String(v ?? '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
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
  // 'simulated': drivers move along routes with dev controls. 'gps': real device GPS only.
  locationMode: ['simulated', 'gps'].includes(process.env.LOCATION_MODE)
    ? process.env.LOCATION_MODE
    : process.env.NODE_ENV === 'production'
      ? 'gps'
      : 'simulated',
  map: {
    center: parseLatLng(process.env.MAP_CENTER) ?? { lat: -1.2864, lng: 36.8172 },
    tileUrl: process.env.MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileAttribution:
      process.env.MAP_TILE_ATTRIBUTION ||
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  geocoder: {
    provider: ['photon', 'mock'].includes(process.env.GEOCODER) ? process.env.GEOCODER : 'photon',
    url: (process.env.GEOCODER_URL || 'https://photon.komoot.io').replace(/\/$/, ''),
  },
  routing: {
    provider: ['osrm', 'straight'].includes(process.env.ROUTING) ? process.env.ROUTING : 'osrm',
    url: (process.env.ROUTING_URL || 'https://router.project-osrm.org').replace(/\/$/, ''),
    // OSRM's car profile assumes empty roads; scale its durations for city traffic.
    durationFactor: Math.min(Math.max(num(process.env.ROUTE_DURATION_FACTOR, 1.5), 0.5), 5),
  },
  // Identifies us to the public OSM services, as their usage policies require.
  userAgent: process.env.GEO_USER_AGENT || 'BoltMotoDev/0.1 (local development)',
  fare: {
    currency: process.env.FARE_CURRENCY || 'USD',
    base: num(process.env.FARE_BASE, 1.0),
    perKm: num(process.env.FARE_PER_KM, 0.45),
    perMin: num(process.env.FARE_PER_MIN, 0.08),
    minimum: num(process.env.FARE_MINIMUM, 2.0),
  },
};

export const googleEnabled = Boolean(env.google.clientId && env.google.clientSecret);
