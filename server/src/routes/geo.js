import { Router } from 'express';
import { env } from '../config/env.js';
import { validLatLng } from '../lib/geometry.js';
import { createRateLimiter } from '../lib/throttle.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { reverseGeocode, searchPlaces } from '../services/geo.js';
import { getRoute } from '../services/routing.js';

const router = Router();
router.use(requireAuth);

// Upstream services allow ~1 req/s in total; keep any one user from hogging the queue.
const limit = createRateLimiter({ windowMs: 10_000, max: 15 });
router.use((req, _res, next) => (limit(req.user.id) ? next() : next(new HttpError(429, 'Too many map requests, slow down'))));

function readLatLng(lat, lng, label = 'location') {
  const p = { lat: Number(lat), lng: Number(lng) };
  if (!validLatLng(p.lat, p.lng)) throw new HttpError(400, `Invalid ${label}`);
  return p;
}
const readPair = (v, label) => readLatLng(...String(v ?? '').split(','), label);

/** GET /api/geo/search?q=westlands[&lat=&lng=]: autocomplete suggestions near the given point. */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 3) return res.json({ results: [] });
    const near = req.query.lat != null ? readLatLng(req.query.lat, req.query.lng) : env.map.center;
    res.json({ results: await searchPlaces(q, { near }) });
  }),
);

/** GET /api/geo/reverse?lat=&lng=: address for a dropped pin. */
router.get(
  '/reverse',
  asyncHandler(async (req, res) => {
    const p = readLatLng(req.query.lat, req.query.lng);
    res.json({ place: await reverseGeocode(p.lat, p.lng) });
  }),
);

/** GET /api/geo/route?from=lat,lng&to=lat,lng: road route (used by the dev route stepper). */
router.get(
  '/route',
  asyncHandler(async (req, res) => {
    const from = readPair(req.query.from, 'from');
    const to = readPair(req.query.to, 'to');
    res.json({ route: await getRoute(from, to) });
  }),
);

export default router;
