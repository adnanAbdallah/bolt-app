import { env } from '../config/env.js';
import { Ride } from '../models/Ride.js';
import { User } from '../models/User.js';

/**
 * Mock pricing engine for Level 1.
 *
 * Without a maps provider we derive stable pseudo-coordinates from the address
 * text, so the same pickup/dropoff pair always yields the same distance.
 * The "dynamic" part is a surge multiplier driven by live demand
 * (open requests) vs. supply (online drivers), plus a peak-hour bump.
 */

const AVG_SPEED_KMH = 24; // typical moto speed in city traffic
export const CITY_CENTER = { lat: -1.2864, lng: 36.8172 }; // arbitrary anchor for mock coords

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

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function peakHourMultiplier(date = new Date()) {
  const h = date.getHours();
  const isPeak = (h >= 7 && h < 10) || (h >= 17 && h < 20);
  return isPeak ? 1.2 : 1;
}

export async function getSurgeMultiplier() {
  const [openRequests, onlineDrivers] = await Promise.all([
    Ride.countDocuments({ status: 'requested' }),
    User.countDocuments({ role: 'driver', isOnline: true }),
  ]);
  const ratio = openRequests / Math.max(onlineDrivers, 1);
  // 1.0x when supply meets demand, up to 2.0x at 4+ requests per driver.
  const demand = 1 + Math.min(Math.max(ratio - 1, 0), 3) / 3;
  const surge = Math.min(demand * peakHourMultiplier(), 2.5);
  return { surge: +surge.toFixed(2), openRequests, onlineDrivers };
}

const round2 = (n) => Math.round(n * 100) / 100;

export async function estimateFare(pickupAddress, dropoffAddress) {
  const pickup = mockGeocode(pickupAddress);
  const dropoff = mockGeocode(dropoffAddress);

  // Road distance is longer than straight-line; 1.3 is a common approximation.
  const distanceKm = Math.max(round2(haversineKm(pickup, dropoff) * 1.3), 0.5);
  const durationMin = Math.max(Math.round((distanceKm / AVG_SPEED_KMH) * 60), 3);

  const { surge, openRequests, onlineDrivers } = await getSurgeMultiplier();
  const { base, perKm, perMin, minimum, currency } = env.fare;

  const subtotal = base + perKm * distanceKm + perMin * durationMin;
  const fare = round2(Math.max(subtotal * surge, minimum));

  return {
    pickup,
    dropoff,
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
