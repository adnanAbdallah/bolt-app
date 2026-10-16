import { useCallback, useEffect, useRef, useState } from 'react';
import { CITY_CENTER } from './geo.js';

const STORAGE_KEY = 'bolt.locationMode';
const SIM_INTERVAL_MS = 4000;
const SIM_STEP_DEG = 0.0009; // ~100 m per tick

function readMode() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'gps' || v === 'simulated') return v;
  } catch {
    /* storage unavailable */
  }
  // In development the demo city is far from wherever you are, so simulate by default.
  return import.meta.env.DEV ? 'simulated' : 'gps';
}

/**
 * While `enabled`, streams the driver's position to the server over the socket.
 * mode 'gps' uses the browser's Geolocation API and falls back to simulation if denied.
 * Returns { mode, setMode, source, error } where source is what is actually being sent.
 */
export function useDriverLocation(socket, enabled) {
  const [mode, setModeState] = useState(readMode);
  const [source, setSource] = useState(null);
  const [error, setError] = useState(null);
  const simPos = useRef(null);

  const setMode = useCallback((m) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!enabled || !socket) {
      setSource(null);
      return undefined;
    }
    let simTimer = null;
    let watchId = null;
    const send = (p) => socket.emit('driver:location', p);

    const startSim = () => {
      setSource('simulated');
      simPos.current ??= {
        lat: CITY_CENTER.lat + (Math.random() - 0.5) * 0.04,
        lng: CITY_CENTER.lng + (Math.random() - 0.5) * 0.04,
        heading: Math.random() * 360,
      };
      const tick = () => {
        const p = simPos.current;
        p.heading = (p.heading + (Math.random() - 0.5) * 40 + 360) % 360;
        const rad = (p.heading * Math.PI) / 180;
        p.lat += Math.cos(rad) * SIM_STEP_DEG;
        p.lng += Math.sin(rad) * SIM_STEP_DEG;
        if (Math.hypot(p.lat - CITY_CENTER.lat, p.lng - CITY_CENTER.lng) > 0.04) p.heading = (p.heading + 180) % 360;
        send({ lat: p.lat, lng: p.lng, heading: p.heading, simulated: true });
      };
      tick();
      simTimer = setInterval(tick, SIM_INTERVAL_MS);
    };

    setError(null);
    if (mode === 'gps' && 'geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        ({ coords }) => {
          setSource('gps');
          send({
            lat: coords.latitude,
            lng: coords.longitude,
            heading: Number.isFinite(coords.heading) ? coords.heading : undefined,
            accuracy: coords.accuracy,
          });
        },
        (err) => {
          setError(err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'GPS unavailable');
          if (watchId != null) navigator.geolocation.clearWatch(watchId);
          watchId = null;
          if (!simTimer) startSim();
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
    } else {
      startSim();
    }

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      clearInterval(simTimer);
    };
  }, [socket, enabled, mode]);

  return { mode, setMode, source, error };
}
