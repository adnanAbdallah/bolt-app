import { env } from '../config/env.js';
import { createCache, createThrottle } from '../lib/throttle.js';
import { mockGeocode } from './fare.js';

/**
 * Address search (autocomplete) and reverse geocoding.
 * Provider 'photon' (komoot.io by default) is OSM-based and allows type-ahead search.
 * Nominatim's policy forbids autocomplete, so it is not used for search.
 * Any provider failure falls back to the deterministic offline mock.
 */

const throttle = createThrottle(1000);
const cache = createCache({ max: 1000 });
const TIMEOUT_MS = 6000;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': env.userAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  return res.json();
}

const AREA_KEYS = ['district', 'locality', 'suburb', 'neighbourhood', 'city'];

/** Turn a Photon GeoJSON feature into { address, area, lat, lng }. */
function fromPhoton(f) {
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [];
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const parts = [p.name, street && street !== p.name ? street : null, p.district ?? p.locality, p.city ?? p.county].filter(Boolean);
  const unique = parts.filter((x, i) => parts.indexOf(x) === i);
  return {
    address: unique.slice(0, 3).join(', ') || p.city || 'Dropped pin',
    area: AREA_KEYS.map((k) => p[k]).find(Boolean) ?? null,
    lat,
    lng,
  };
}

function mockResult(text) {
  const g = mockGeocode(text);
  return { address: g.address, area: null, lat: g.lat, lng: g.lng, approximate: true };
}

/** Up to `limit` places matching `q`, biased toward `near` (defaults to the map centre). */
export async function searchPlaces(q, { near = env.map.center, limit = 6 } = {}) {
  const query = q.trim().slice(0, 120);
  if (env.geocoder.provider === 'mock') return [mockResult(query)];
  const key = `s:${query.toLowerCase()}:${near.lat.toFixed(2)},${near.lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const url = `${env.geocoder.url}/api/?q=${encodeURIComponent(query)}&lat=${near.lat}&lon=${near.lng}&limit=${limit}&lang=en`;
    const data = await throttle(() => fetchJson(url));
    const results = (data.features ?? []).map(fromPhoton).filter((r) => Number.isFinite(r.lat));
    cache.set(key, results);
    return results;
  } catch (err) {
    if (err.status === 429) throw err;
    console.warn('geocoder search failed, using offline fallback:', err.message);
    return [mockResult(query)];
  }
}

/** Best-effort address for a coordinate. Never throws: falls back to "Dropped pin". */
export async function reverseGeocode(lat, lng) {
  const fallback = { address: `Dropped pin (${lat.toFixed(5)}, ${lng.toFixed(5)})`, area: null, lat, lng };
  if (env.geocoder.provider === 'mock') return fallback;
  const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, lat, lng };
  try {
    const data = await throttle(() => fetchJson(`${env.geocoder.url}/reverse?lat=${lat}&lon=${lng}&lang=en`));
    const f = data.features?.[0];
    if (!f) return fallback;
    const r = fromPhoton(f);
    cache.set(key, r);
    return { ...r, lat, lng }; // keep the exact pin, not the matched feature's centre
  } catch (err) {
    console.warn('reverse geocode failed:', err.message);
    return fallback;
  }
}
