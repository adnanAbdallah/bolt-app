/**
 * Small geodesy helpers. Points are { lat, lng }; polylines are [[lat, lng], ...].
 * Mirrored in client/src/lib/geometry.js. Keep the two in sync.
 */

const R = 6_371_000; // Earth radius, metres
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const toPoint = (p) => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p);

/** Great-circle distance in metres. */
export function distanceM(a, b) {
  const p = toPoint(a);
  const q = toPoint(b);
  const dLat = rad(q.lat - p.lat);
  const dLng = rad(q.lng - p.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p.lat)) * Math.cos(rad(q.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees clockwise from north (0–360). */
export function bearing(a, b) {
  const p = toPoint(a);
  const q = toPoint(b);
  const y = Math.sin(rad(q.lng - p.lng)) * Math.cos(rad(q.lat));
  const x = Math.cos(rad(p.lat)) * Math.sin(rad(q.lat)) - Math.sin(rad(p.lat)) * Math.cos(rad(q.lat)) * Math.cos(rad(q.lng - p.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point `meters` away from `p` in direction `headingDeg`. */
export function offset(p, meters, headingDeg) {
  const { lat, lng } = toPoint(p);
  const d = meters / R;
  const h = rad(headingDeg);
  const lat2 = Math.asin(Math.sin(rad(lat)) * Math.cos(d) + Math.cos(rad(lat)) * Math.sin(d) * Math.cos(h));
  const lng2 = rad(lng) + Math.atan2(Math.sin(h) * Math.sin(d) * Math.cos(rad(lat)), Math.cos(d) - Math.sin(rad(lat)) * Math.sin(lat2));
  return { lat: deg(lat2), lng: ((deg(lng2) + 540) % 360) - 180 };
}

/** Cumulative distance (m) at each vertex; last entry is the total length. */
export function cumulative(line) {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + distanceM(line[i - 1], line[i]));
  return out;
}

export const lineLength = (line) => (line.length < 2 ? 0 : cumulative(line).at(-1));

/** Position and heading `along` metres from the start of the polyline (clamped to its ends). */
export function pointAlong(line, along, cum = cumulative(line)) {
  if (line.length === 0) return null;
  if (line.length === 1) return { lat: line[0][0], lng: line[0][1], heading: 0 };
  const total = cum.at(-1);
  const d = Math.max(0, Math.min(along, total));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / segLen;
  const [aLat, aLng] = line[i - 1];
  const [bLat, bLng] = line[i];
  return { lat: aLat + (bLat - aLat) * t, lng: aLng + (bLng - aLng) * t, heading: bearing(line[i - 1], line[i]) };
}

/**
 * Closest point on the polyline to `p`.
 * Returns { along (m from start), offRoute (m from the line), lat, lng }.
 * Uses a local equirectangular projection per segment: accurate at city scale.
 *
 * Routes can run out and back along the same street, so several segments may be (almost)
 * equally close. Pass `hint` (the previous `along`) to pick the match nearest to it.
 */
const TIE_M = 15;

export function project(line, p, cum = cumulative(line), hint = null) {
  const q = toPoint(p);
  if (line.length === 0) return null;
  if (line.length === 1) return { along: 0, offRoute: distanceM(line[0], q), lat: line[0][0], lng: line[0][1] };
  let best = null;
  const candidates = [];
  const kx = Math.cos(rad(q.lat));
  for (let i = 1; i < line.length; i++) {
    const [aLat, aLng] = line[i - 1];
    const [bLat, bLng] = line[i];
    const ax = aLng * kx, ay = aLat, bx = bLng * kx, by = bLat, px = q.lng * kx, py = q.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const lat = aLat + (bLat - aLat) * t;
    const lng = aLng + (bLng - aLng) * t;
    const off = distanceM({ lat, lng }, q);
    const cand = { along: cum[i - 1] + (cum[i] - cum[i - 1]) * t, offRoute: off, lat, lng };
    candidates.push(cand);
    if (!best || off < best.offRoute) best = cand;
  }
  if (hint == null || candidates.length < 2) return best;
  return candidates
    .filter((c) => c.offRoute <= best.offRoute + TIE_M)
    .reduce((a, c) => (Math.abs(c.along - hint) < Math.abs(a.along - hint) ? c : a));
}

/** Drop vertices so consecutive points are at least `minM` apart (keeps first and last). */
export function simplify(line, minM = 10) {
  if (line.length <= 2) return line;
  const out = [line[0]];
  for (let i = 1; i < line.length - 1; i++) if (distanceM(out.at(-1), line[i]) >= minM) out.push(line[i]);
  out.push(line.at(-1));
  return out;
}

export const validLatLng = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
