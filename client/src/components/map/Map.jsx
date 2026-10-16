import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAppConfig } from '../../lib/appConfig.js';
import { esc } from './markers.js';

/**
 * Declarative Leaflet map shared by the passenger, driver and admin screens.
 *
 * markers: [{ id, lat, lng, html, size:[w,h], anchor:[x,y], rotation?, tooltip? (plain text),
 *             zIndex?, draggable?, onDragEnd?(latlng), onClick?(), animate? }]
 * lines:   [{ id, coords:[[lat,lng]...], color, weight?, dashArray?, opacity? }]
 * circles: [{ id, lat, lng, radius (m), color, tooltip? }]
 * fit:     { key, points:[[lat,lng]...], maxZoom? }. Re-frames whenever `key` changes.
 * onMapClick?(latlng)
 *
 * Markers and shapes are diffed by id and updated in place; `animate` markers glide to
 * their new position, so live updates move instead of jumping.
 */
const ANIM_MS = 900;

export default function MapView({ markers = [], lines = [], circles = [], fit, onMapClick, center, zoom = 14, className = '', label = 'Map' }) {
  const config = useAppConfig();
  const el = useRef(null);
  const map = useRef(null);
  const tiles = useRef(null);
  const layers = useRef({ markers: new Map(), lines: new Map(), circles: new Map() });
  const fitKey = useRef(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  useEffect(() => {
    const start = center ?? config?.map.center ?? { lat: -1.2864, lng: 36.8172 };
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], zoom);
    m.on('click', (e) => clickRef.current?.(e.latlng));
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    const store = layers.current;
    return () => {
      ro.disconnect();
      for (const mk of store.markers.values()) cancelAnimationFrame(mk._anim);
      m.remove();
      map.current = null;
      tiles.current = null;
      store.markers.clear();
      store.lines.clear();
      store.circles.clear();
      fitKey.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tile layer (URL and attribution come from server config, so production can use its own provider).
  useEffect(() => {
    const m = map.current;
    if (!m || !config) return;
    if (tiles.current) tiles.current.remove();
    tiles.current = L.tileLayer(config.map.tileUrl, { maxZoom: 19, attribution: config.map.tileAttribution }).addTo(m);
    if (!center && !fitKey.current) m.setView([config.map.center.lat, config.map.center.lng], zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // Markers
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const store = layers.current.markers;
    const seen = new Set();
    for (const spec of markers) {
      if (spec.lat == null || spec.lng == null) continue;
      seen.add(spec.id);
      const pos = L.latLng(spec.lat, spec.lng);
      let mk = store.get(spec.id);
      if (!mk) {
        mk = L.marker(pos, {
          icon: L.divIcon({ className: '', html: spec.html, iconSize: spec.size, iconAnchor: spec.anchor ?? spec.size?.map((n) => n / 2) }),
          draggable: Boolean(spec.draggable),
          keyboard: Boolean(spec.onClick || spec.draggable),
        }).addTo(m);
        mk._html = spec.html;
        store.set(spec.id, mk);
      } else {
        if (mk._html !== spec.html) {
          mk.setIcon(L.divIcon({ className: '', html: spec.html, iconSize: spec.size, iconAnchor: spec.anchor ?? spec.size?.map((n) => n / 2) }));
          mk._html = spec.html;
        }
        if (spec.animate) glide(mk, pos);
        else if (!mk.getLatLng().equals(pos)) mk.setLatLng(pos);
      }
      // Swap only our own handlers; Leaflet attaches its own (e.g. tooltips on touch).
      if (mk._onClick) mk.off('click', mk._onClick);
      if (mk._onDragEnd) mk.off('dragend', mk._onDragEnd);
      mk._onClick = spec.onClick ? () => spec.onClick() : null;
      mk._onDragEnd = spec.onDragEnd ? () => spec.onDragEnd(mk.getLatLng()) : null;
      if (mk._onClick) mk.on('click', mk._onClick);
      if (mk._onDragEnd) mk.on('dragend', mk._onDragEnd);
      if (spec.draggable) mk.dragging?.enable();
      else mk.dragging?.disable();
      mk.setZIndexOffset(spec.zIndex ?? 0);
      if (spec.tooltip) {
        const html = esc(spec.tooltip).replace(/\n/g, '<br>');
        if (mk.getTooltip()) mk.setTooltipContent(html);
        else mk.bindTooltip(html, { direction: 'top', offset: [0, -14] });
      } else if (mk.getTooltip()) mk.unbindTooltip();
      if (spec.rotation != null) {
        const r = mk.getElement()?.querySelector('[data-rotate]');
        if (r) r.style.transform = `rotate(${spec.rotation}deg)`;
      }
    }
    for (const [id, mk] of store) {
      if (!seen.has(id)) {
        cancelAnimationFrame(mk._anim);
        mk.remove();
        store.delete(id);
      }
    }
  }, [markers]);

  // Lines
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const store = layers.current.lines;
    const seen = new Set();
    for (const spec of lines) {
      if (!spec.coords || spec.coords.length < 2) continue;
      seen.add(spec.id);
      const style = { color: spec.color, weight: spec.weight ?? 5, opacity: spec.opacity ?? 0.9, dashArray: spec.dashArray ?? null, lineCap: 'round', lineJoin: 'round', interactive: false };
      const existing = store.get(spec.id);
      if (existing) {
        existing.setLatLngs(spec.coords);
        existing.setStyle(style);
      } else store.set(spec.id, L.polyline(spec.coords, style).addTo(m));
    }
    for (const [id, l] of store) if (!seen.has(id)) (l.remove(), store.delete(id));
  }, [lines]);

  // Circles
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const store = layers.current.circles;
    const seen = new Set();
    for (const spec of circles) {
      if (spec.lat == null) continue;
      seen.add(spec.id);
      const style = { radius: spec.radius, color: spec.color, weight: 2, fillColor: spec.color, fillOpacity: 0.12, dashArray: '6 6' };
      let c = store.get(spec.id);
      if (c) {
        c.setLatLng([spec.lat, spec.lng]);
        c.setStyle(style);
        c.setRadius(spec.radius);
      } else {
        c = L.circle([spec.lat, spec.lng], style).addTo(m);
        store.set(spec.id, c);
      }
      if (spec.tooltip) c.bindTooltip(esc(spec.tooltip));
    }
    for (const [id, c] of store) if (!seen.has(id)) (c.remove(), store.delete(id));
  }, [circles]);

  // Framing
  useEffect(() => {
    const m = map.current;
    if (!m || !fit?.points?.length || fit.key === fitKey.current) return;
    fitKey.current = fit.key;
    const pts = fit.points.filter((p) => p && p[0] != null);
    // Programmatic re-framing is instant: overlapping animated zooms (e.g. accept, then the
    // first driver fix a moment later) can leave Leaflet's tiles stuck mid-zoom.
    m.stop();
    if (pts.length === 1) m.setView(pts[0], Math.max(m.getZoom(), fit.maxZoom ?? 15), { animate: false });
    else if (pts.length > 1) m.fitBounds(pts, { padding: [40, 40], maxZoom: fit.maxZoom ?? 16, animate: false });
  }, [fit]);

  return <div ref={el} className={`isolate z-0 ${className}`} role="region" aria-label={label} />;
}

/** Ease a marker from where it is to `to`. A newer update cancels the running glide. */
function glide(mk, to) {
  const from = mk.getLatLng();
  if (from.equals(to)) return;
  cancelAnimationFrame(mk._anim);
  // Teleports (e.g. dev "jump") or reduced motion: snap.
  if (from.distanceTo(to) > 3000 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    mk.setLatLng(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ANIM_MS);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    mk.setLatLng([from.lat + (to.lat - from.lat) * e, from.lng + (to.lng - from.lng) * e]);
    if (t < 1) mk._anim = requestAnimationFrame(step);
  };
  mk._anim = requestAnimationFrame(step);
}
