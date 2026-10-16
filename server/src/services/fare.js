import { env } from '../config/env.js';
import { Ride } from '../models/Ride.js';
import { User } from '../models/User.js';
import { validLatLng } from '../lib/geometry.js';
import { getRoute } from './routing.js';

/**
 * Pricing engine. Distance and duration come from the road route (services/routing.js).
 * The "dynamic" part is a surge multiplier driven by live demand (open requests)
 * vs. supply (online drivers), plus a peak-hour bump.
 *
 * mockGeocode() is the offline fallback: stable pseudo-coordinates derived from
 * the address text, used by the seed script and when the geocoder is unreachable.
 */

/** Anchor for mock coordinates, the demo fleet and the default map view (MAP_CENTER). */
export const CITY_CENTER = env.map.center;

function hashString(str) {
  let h = 2166136261;
  for (const ch of str.trim().toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic mock coordinates within ~4.5 km of the anchor. */
export function mockGeocode(address) {
  const h = hashString(address);
  const latOffset = ((h & 0xffff) / 0xffff - 0.5) * 0.08;
  const lngOffset = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 0.08;
  return {
    address: address.trim(),
    lat: +(CITY_CENTER.lat + latOffset).toFixed(6),
    lng: +(CITY_CENTER.lng + lngOffset).toFixed(6),
  };
}

function peakHourMultiplier(date = new Date()) {
  const h = date.getHours();
  const isPeak = (h >= 7 && h < 10) || (h >= 17 && h < 20);
  return isPeak ? 1.2 : 1;
}

export async function getSurgeMultiplier() {
  const [openRequests, onlineDrivers] = await Promise.all([
    Ride.countDocuments({ status: 'requested' }),
    User.countDocuments({ role: 'driver', isOnline: true, status: { $ne: 'banned' } }),
  ]);
  const ratio = openRequests / Math.max(onlineDrivers, 1);
  // 1.0x when supply meets demand, up to 2.0x at 4+ requests per driver.
  const demand = 1 + Math.min(Math.max(ratio - 1, 0), 3) / 3;
  const surge = Math.min(demand * peakHourMultiplier(), 2.5);
  return { surge: +surge.toFixed(2), openRequests, onlineDrivers };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Accepts a place object { address, lat, lng, area? } (from search or a map pin) or,
 * for older clients and the seed script, a plain address string (mock-geocoded).
 */
export function resolvePlace(input) {
  if (typeof input === 'string') {
    const text = input.trim();
    return text ? { ...mockGeocode(text), area: null } : null;
  }
  if (!input || typeof input !== 'object') return null;
  const address = typeof input.address === 'string' ? input.address.trim().slice(0, 200) : '';
  if (!address || !validLatLng(input.lat, input.lng)) return null;
  const area = typeof input.area === 'string' && input.area.trim() ? input.area.trim().slice(0, 80) : null;
  return { address, lat: +input.lat.toFixed(6), lng: +input.lng.toFixed(6), area };
}

/**
 * Price a trip from its road route. `offline: true` skips the routing service
 * (straight line x 1.3), which the seed script uses.
 */
export async function estimateFare(pickupInput, dropoffInput, { offline = false } = {}) {
  const pickup = resolvePlace(pickupInput);
  const dropoff = resolvePlace(dropoffInput);
  if (!pickup || !dropoff) throw Object.assign(new Error('Pickup and dropoff need an address and a location'), { status: 400 });

  const route = await getRoute(pickup, dropoff, { offline });
  const distanceKm = Math.max(route.distanceKm, 0.5);
  const durationMin = Math.max(route.durationMin, 3);

  const { surge, openRequests, onlineDrivers } = await getSurgeMultiplier();
  const { base, perKm, perMin, minimum, currency } = env.fare;

  const subtotal = base + perKm * distanceKm + perMin * durationMin;
  const fare = round2(Math.max(subtotal * surge, minimum));

  return {
    pickup,
    dropoff,
    route,
    distanceKm,
    durationMin,
    surgeMultiplier: surge,
    fare,
    currency,
    breakdown: {
      base,
      distance: round2(perKm * distanceKm),
      time: round2(perMin * durationMin),
      surge,
    },
    market: { openRequests, onlineDrivers },
  };
}
