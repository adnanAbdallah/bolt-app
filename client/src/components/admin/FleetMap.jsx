import { useMemo } from 'react';
import LazyMap from '../map/LazyMap.jsx';
import { GLYPHS as BASE_GLYPHS, PIN_SIZE, pinHtml, vehicleHtml } from '../map/markers.js';

/** Matches the passenger app: no position for 30 s means "No recent signal". */
export const STALE_MS = 30 * 1000;

/** available | pickup | trip | stale: drives both the marker and the list legend. */
export function driverState(d) {
  if (!d.location || Date.now() - new Date(d.location.updatedAt) > STALE_MS) return 'stale';
  if (d.trip?.status === 'ongoing') return 'trip';
  if (d.trip) return 'pickup';
  return 'available';
}

// Colors validated for colorblind separation; each state also has its own glyph so
// identity never depends on color alone.
const GLYPHS = { available: BASE_GLYPHS.bike, pickup: BASE_GLYPHS.nav, trip: BASE_GLYPHS.person, stale: BASE_GLYPHS.dash };
const GLYPH_NAME = { available: 'bike', pickup: 'nav', trip: 'person', stale: 'dash' };

export const STATE_STYLE = {
  available: { label: 'Available', color: '#16a34a' },
  pickup: { label: 'Heading to pickup', color: '#2563eb' },
  trip: { label: 'On trip', color: '#ea580c' },
  stale: { label: 'No recent signal', color: '#9ca3af' },
};

export function StateGlyph({ state, className = 'h-3 w-3' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: GLYPHS[state] }} />
  );
}

/**
 * Admin map of online drivers. With a selected driver on a trip, `trip` (the full admin ride)
 * adds their route and pickup/dropoff pins.
 */
export default function FleetMap({ drivers, selectedId, onSelect, trip, className = '' }) {
  const markers = useMemo(() => {
    const list = drivers
      .filter((d) => d.location)
      .map((d) => {
        const state = driverState(d);
        const selected = d.id === selectedId;
        const size = selected ? 32 : 26;
        return {
          id: d.id,
          lat: d.location.lat,
          lng: d.location.lng,
          html: vehicleHtml({ color: STATE_STYLE[state].color, glyph: GLYPH_NAME[state], size, selected, showHeading: d.location.heading != null }),
          size: [size, size],
          rotation: d.location.heading ?? null,
          animate: true,
          zIndex: selected ? 1000 : 0,
          tooltip: `${d.name}\n${STATE_STYLE[state].label}${d.vehicle?.plate ? ` · ${d.vehicle.plate}` : ''}`,
          onClick: () => onSelect?.(d.id),
        };
      });
    if (trip) {
      for (const kind of ['pickup', 'dropoff']) {
        const place = kind === 'pickup' ? trip.pickupLocation : trip.dropoffLocation;
        const [w, h, ax, ay] = PIN_SIZE[kind];
        list.push({ id: `trip-${kind}`, lat: place.lat, lng: place.lng, html: pinHtml(kind), size: [w, h], anchor: [ax, ay], tooltip: `${kind === 'pickup' ? 'Pickup' : 'Dropoff'}: ${place.address}` });
      }
    }
    return list;
  }, [drivers, selectedId, onSelect, trip]);

  const lines = useMemo(() => {
    if (!trip) return [];
    const route = trip.route?.coordinates ?? [[trip.pickupLocation.lat, trip.pickupLocation.lng], [trip.dropoffLocation.lat, trip.dropoffLocation.lng]];
    const out = [{ id: 'trip-route', coords: route, color: STATE_STYLE.trip.color, weight: trip.status === 'ongoing' ? 6 : 4, dashArray: trip.status === 'ongoing' ? null : '8 8', opacity: trip.status === 'ongoing' ? 0.9 : 0.6 }];
    if (trip.status === 'accepted' && trip.approachRoute) out.push({ id: 'trip-approach', coords: trip.approachRoute.coordinates, color: STATE_STYLE.pickup.color, weight: 6 });
    return out;
  }, [trip]);

  // Frame the fleet once on first data; afterwards, frame the selected trip.
  const located = drivers.filter((d) => d.location);
  const fit = useMemo(() => {
    if (trip) return { key: `trip:${trip.id}:${trip.status}`, points: [...(trip.approachRoute?.coordinates ?? []), ...(trip.route?.coordinates ?? []), [trip.pickupLocation.lat, trip.pickupLocation.lng], [trip.dropoffLocation.lat, trip.dropoffLocation.lng]] };
    return located.length ? { key: 'fleet', points: located.map((d) => [d.location.lat, d.location.lng]), maxZoom: 15 } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, trip?.status, located.length > 0]);

  return <LazyMap markers={markers} lines={lines} fit={fit} className={className} label="Map of online drivers" />;
}
