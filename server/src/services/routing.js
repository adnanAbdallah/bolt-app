import { env } from '../config/env.js';
import { distanceM, simplify } from '../lib/geometry.js';
import { createCache, createThrottle } from '../lib/throttle.js';

/**
 * Road routes between two points: { coordinates: [[lat,lng]...], distanceKm, durationMin, source }.
 * 'osrm' uses ROUTING_URL (the public OSRM demo server is for development only).
 * On failure, or with ROUTING=straight / { offline: true }, returns a straight-line estimate.
 */

const throttle = createThrottle(1000);
const cache = createCache({ max: 1000, ttlMs: 6 * 3600_000 });
const ROAD_FACTOR = 1.3; // straight line → typical road distance
const FALLBACK_SPEED_KMH = 24;
const round2 = (n) => Math.round(n * 100) / 100;

export function straightRoute(from, to) {
  const km = Math.max((distanceM(from, to) / 1000) * ROAD_FACTOR, 0.05);
  return {
    coordinates: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    distanceKm: round2(km),
    durationMin: Math.max(1, Math.round((km / FALLBACK_SPEED_KMH) * 60)),
    source: 'straight',
  };
}

export async function getRoute(from, to, { offline = false } = {}) {
  if (offline || env.routing.provider === 'straight') return straightRoute(from, to);
  const key = [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(5)).join(',');
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const url = `${env.routing.url}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const data = await throttle(async () => {
      const res = await fetch(url, { headers: { 'User-Agent': env.userAgent }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Routing HTTP ${res.status}`);
      return res.json();
    });
    const r = data.routes?.[0];
    if (data.code !== 'Ok' || !r) throw new Error(`Routing: ${data.code ?? 'no route'}`);
    const coordinates = simplify(
      r.geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(6), +lng.toFixed(6)]),
      8,
    );
    const route = {
      coordinates,
      distanceKm: round2(Math.max(r.distance / 1000, 0.05)),
      durationMin: Math.max(1, Math.round((r.duration * env.routing.durationFactor) / 60)),
      source: 'osrm',
    };
    cache.set(key, route);
    return route;
  } catch (err) {
    console.warn('routing failed, using straight line:', err.message);
    return straightRoute(from, to);
  }
}
