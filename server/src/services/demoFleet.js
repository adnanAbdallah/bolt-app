import { User } from '../models/User.js';
import { cumulative, offset, pointAlong } from '../lib/geometry.js';
import { CITY_CENTER } from './fare.js';
import { updateDriverLocation } from './realtime.js';
import { getRoute } from './routing.js';

/**
 * Dev-only: seeded demo drivers (isDemo: true, online) ride along real roads to random
 * nearby destinations, so the admin Live fleet map shows realistic motion.
 * Enable with SIMULATE_DEMO_FLEET=true; seed drivers with `npm run seed`.
 */
const TICK_MS = 3000;
const STEP_M = 40; // per tick, about 48 km/h
const MAX_FROM_CENTER_M = 5000;

const routes = new Map(); // driverId -> { line, cum, along, pending }

function pickDestination(pos) {
  const centre = CITY_CENTER;
  // Drift back toward the centre when far out, otherwise wander 0.8–2.5 km.
  const far = Math.hypot(pos.lat - centre.lat, pos.lng - centre.lng) * 111_000 > MAX_FROM_CENTER_M;
  return far ? offset(centre, Math.random() * 1500, Math.random() * 360) : offset(pos, 800 + Math.random() * 1700, Math.random() * 360);
}

async function tickDriver(d) {
  const id = d._id.toString();
  const pos = d.location?.lat != null ? d.location : offset(CITY_CENTER, Math.random() * 2000, Math.random() * 360);
  let st = routes.get(id);

  if (!st || st.along >= st.cum.at(-1)) {
    if (st?.pending) return;
    routes.set(id, { ...(st ?? { line: [[pos.lat, pos.lng]], cum: [0], along: 0 }), pending: true });
    const r = await getRoute(pos, pickDestination(pos));
    routes.set(id, { line: r.coordinates, cum: cumulative(r.coordinates), along: 0, pending: false });
    st = routes.get(id);
  }
  st.along += STEP_M;
  const p = pointAlong(st.line, st.along, st.cum);
  await updateDriverLocation(id, { lat: p.lat, lng: p.lng, heading: p.heading, simulated: true }, { trusted: true });
}

export function startDemoFleet() {
  console.log('Demo fleet simulator running (SIMULATE_DEMO_FLEET=true)');
  const timer = setInterval(async () => {
    try {
      const drivers = await User.find({ isDemo: true, role: 'driver', isOnline: true, status: { $ne: 'banned' } })
        .select('location')
        .lean();
      await Promise.all(drivers.map((d) => tickDriver(d).catch((err) => console.error('demo driver tick failed', err.message))));
    } catch (err) {
      console.error('demo fleet tick failed', err);
    }
  }, TICK_MS);
  timer.unref();
}
