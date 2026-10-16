import { useEffect, useState } from 'react';
import { api } from './api.js';

const FALLBACK = {
  googleEnabled: false,
  devLoginEnabled: false,
  locationMode: import.meta.env.DEV ? 'simulated' : 'gps',
  map: {
    center: { lat: -1.2864, lng: 36.8172 },
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};

let cached = null;
let pending = null;

/** Server settings (/api/auth/config): sign-in options, location mode, map tiles and centre. Fetched once. */
export function loadAppConfig() {
  if (cached) return Promise.resolve(cached);
  pending ??= api
    .authConfig()
    .then((c) => (cached = { ...FALLBACK, ...c, map: { ...FALLBACK.map, ...c.map } }))
    .catch(() => (cached = FALLBACK));
  return pending;
}

export function useAppConfig() {
  const [config, setConfig] = useState(cached);
  useEffect(() => {
    if (!cached) loadAppConfig().then(setConfig);
  }, []);
  return config;
}
