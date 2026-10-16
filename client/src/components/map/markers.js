/**
 * HTML for Leaflet divIcons. Anything user-supplied must go through esc().
 * Rotating parts carry data-rotate so the map can turn them without rebuilding the icon.
 */

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const GLYPHS = {
  bike: '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  nav: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  dash: '<path d="M5 12h14"/>',
};

/** Round vehicle marker with an optional heading arrow (rotated via data-rotate). */
export function vehicleHtml({ color, glyph = 'bike', size = 26, selected = false, showHeading = true }) {
  const ring = selected ? `,0 0 0 4px ${color}55` : '';
  const arrow = showHeading
    ? `<span data-rotate style="position:absolute;inset:-8px;transition:transform .6s ease-out"><span style="position:absolute;left:50%;top:0;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid ${color}"></span></span>`
    : '';
  return `<span style="position:relative;display:flex;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)${ring};align-items:center;justify-content:center">${arrow}<svg width="${size * 0.5}" height="${size * 0.5}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[glyph] ?? GLYPHS.bike}</svg></span>`;
}

/** Pickup (green dot) / dropoff (red pin) markers, matching the app's RouteSummary icons. */
export function pinHtml(kind) {
  if (kind === 'pickup') {
    return '<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#34d186;border:4px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>';
  }
  return '<svg width="30" height="38" viewBox="0 0 30 38" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))"><path d="M15 37s13-12.5 13-22A13 13 0 0 0 2 15c0 9.5 13 22 13 22z" fill="#ef4444" stroke="#fff" stroke-width="2.5"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>';
}

export const PIN_SIZE = { pickup: [18, 18, 9, 9], dropoff: [30, 38, 15, 37] }; // w, h, anchorX, anchorY
