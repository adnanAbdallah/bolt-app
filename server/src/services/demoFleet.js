import { User } from '../models/User.js';
import { CITY_CENTER } from './fare.js';
import { updateDriverLocation } from './realtime.js';

/**
 * Dev-only: moves seeded demo drivers (isDemo: true, online) around the city every few
 * seconds so the admin Live Fleet map shows motion without real phones.
 * Enable with SIMULATE_DEMO_FLEET=true; seed drivers with `npm run seed`.
 */
const TICK_MS = 3000;
const MAX_RADIUS_DEG = 0.045; // ~5 km
const STEP_DEG = 0.0012; // ~130 m per tick ≈ 155 km/h on paper; reads well on a map

const headings = new Map();

function step({ lat, lng }, id) {
  let heading = headings.get(id) ?? Math.random() * 360;
  heading = (heading + (Math.random() - 0.5) * 50 + 360) % 360;
  const rad = (heading * Math.PI) / 180;
  let next = { lat: lat + Math.cos(rad) * STEP_DEG, lng: lng + Math.sin(rad) * STEP_DEG };
  // Turn back toward the centre when drifting out of the area.
  if (Math.hypot(next.lat - CITY_CENTER.lat, next.lng - CITY_CENTER.lng) > MAX_RADIUS_DEG) {
    heading = (heading + 180) % 360;
    next = { lat, lng };
  }
  headings.set(id, heading);
  return { ...next, heading };
}

export function startDemoFleet() {
  console.log('Demo fleet simulator running (SIMULATE_DEMO_FLEET=true)');
  const timer = setInterval(async () => {
    try {
      const drivers = await User.find({ isDemo: true, role: 'driver', isOnline: true, status: { $ne: 'banned' } })
        .select('location')
        .lean();
      await Promise.all(
        drivers.map((d) => {
          const from = d.location?.lat != null ? d.location : CITY_CENTER;
          return updateDriverLocation(d._id, { ...step(from, d._id.toString()), simulated: true });
        }),
      );
    } catch (err) {
      console.error('demo fleet tick failed', err);
    }
  }, TICK_MS);
  timer.unref();
}
