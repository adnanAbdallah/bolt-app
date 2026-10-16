import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CITY_CENTER } from '../../lib/geo.js';

// Driver names and plates are user-supplied; escape before they go into Leaflet's HTML.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const STALE_MS = 2 * 60 * 1000;

/** available | pickup | trip | stale: drives both the marker and the list legend. */
export function driverState(d) {
  if (!d.location || Date.now() - new Date(d.location.updatedAt) > STALE_MS) return 'stale';
  if (d.trip?.status === 'ongoing') return 'trip';
  if (d.trip) return 'pickup';
  return 'available';
}

// Colors validated for colorblind separation; each state also has its own glyph so
// identity never depends on color alone.
const GLYPHS = {
  available: '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  pickup: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  trip: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  stale: '<path d="M5 12h14"/>',
};

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

function icon(d, selected) {
  const state = driverState(d);
  const { color } = STATE_STYLE[state];
  const heading = d.location?.heading;
  const arrow =
    heading != null
      ? `<span style="position:absolute;inset:-7px;transform:rotate(${heading}deg)"><span style="position:absolute;left:50%;top:0;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:7px solid ${color}"></span></span>`
      : '';
  const size = selected ? 30 : 24;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="position:relative;display:flex;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)${selected ? `,0 0 0 4px ${color}55` : ''};align-items:center;justify-content:center">${arrow}<svg width="${size * 0.5}" height="${size * 0.5}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[state]}</svg></span>`,
  });
}

/** Leaflet map of online drivers. Markers are updated in place so live moves don't flicker. */
export default function FleetMap({ drivers, selectedId, onSelect, className = '' }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map());
  const fitted = useRef(false);

  useEffect(() => {
    map.current = L.map(el.current, { zoomControl: true }).setView([CITY_CENTER.lat, CITY_CENTER.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    const ro = new ResizeObserver(() => map.current?.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.current.remove();
      map.current = null;
      markers.current.clear();
      fitted.current = false;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set();
    for (const d of drivers) {
      if (!d.location) continue;
      seen.add(d.id);
      const pos = [d.location.lat, d.location.lng];
      const tip = `<strong>${esc(d.name)}</strong><br>${STATE_STYLE[driverState(d)].label}${d.vehicle?.plate ? ` · ${esc(d.vehicle.plate)}` : ''}`;
      let mk = markers.current.get(d.id);
      if (!mk) {
        mk = L.marker(pos, { icon: icon(d, d.id === selectedId) }).addTo(m);
        mk.on('click', () => onSelect?.(d.id));
        mk.bindTooltip(tip, { direction: 'top', offset: [0, -14] });
        markers.current.set(d.id, mk);
      } else {
        mk.setLatLng(pos);
        mk.setIcon(icon(d, d.id === selectedId));
        mk.setTooltipContent(tip);
      }
      mk.setZIndexOffset(d.id === selectedId ? 1000 : 0);
    }
    for (const [id, mk] of markers.current) {
      if (!seen.has(id)) {
        mk.remove();
        markers.current.delete(id);
      }
    }
    // Frame the fleet once, on first data; after that the admin controls the view.
    if (!fitted.current && seen.size) {
      const pts = drivers.filter((d) => d.location).map((d) => [d.location.lat, d.location.lng]);
      m.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
      fitted.current = true;
    }
  }, [drivers, selectedId, onSelect]);

  useEffect(() => {
    const d = drivers.find((x) => x.id === selectedId);
    if (d?.location && map.current) map.current.panTo([d.location.lat, d.location.lng], { animate: true });
    // only when the selection changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return <div ref={el} className={`isolate ${className}`} role="region" aria-label="Map of online drivers" />;
}
