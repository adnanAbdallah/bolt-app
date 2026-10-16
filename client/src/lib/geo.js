/** Fallback map centre. The real value comes from the server (MAP_CENTER) via useAppConfig(). */
export const CITY_CENTER = { lat: -1.2864, lng: 36.8172 };

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Turn-by-turn link in the phone's own maps app. */
export function navigationUrl({ lat, lng }) {
  return isIOS()
    ? `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

/** Minutes for `meters` at the route's own average speed (falls back to 24 km/h). */
export function etaMinutes(meters, route) {
  const kmh = route?.distanceKm && route?.durationMin ? (route.distanceKm / route.durationMin) * 60 : 24;
  return Math.max(1, Math.round(meters / 1000 / Math.max(kmh, 5) * 60));
}

export const formatKm = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
