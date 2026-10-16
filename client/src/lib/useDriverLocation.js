import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { etaMinutes } from './geo.js';
import { bearing, cumulative, distanceM, offset, pointAlong, project } from './geometry.js';

export const STEP_SIZES = [50, 100, 250];
export const AUTOPLAY_SPEEDS = [15, 25, 40]; // km/h
export const ARRIVAL_RADIUS_M = 50;
const START_SNAP_M = 150;

const HEARTBEAT_MS = 10_000; // keep "last seen" fresh while a dev driver isn't stepping
const AUTOPLAY_MS = 2_000;
const SIGNAL_LOST_MS = 30_000;
const GPS_MAX_ACCURACY_M = 100;
const GPS_MAX_SPEED_KMH = 150;
const GPS_SEND_EVERY_MS = 3_000;
const GPS_SEND_DIST_M = 20;
const GPS_MIN_GAP_MS = 1_600; // server accepts at most one GPS update per 1.5 s

const REJECTIONS = {
  simulated_not_allowed: 'The server only accepts real GPS in this mode.',
  low_accuracy: 'GPS signal is too weak. Move to open sky.',
  implausible_jump: 'Ignored a GPS jump.',
  invalid_coordinates: 'Received invalid coordinates.',
};

/**
 * The leg a driver is on: approach to the pickup (accepted) or the trip to the dropoff
 * (ongoing). Rides without stored routes fall back to straight lines.
 */
export function activeLeg(ride, position) {
  if (!ride || !['accepted', 'ongoing'].includes(ride.status)) return null;
  const pickup = [ride.pickupLocation.lat, ride.pickupLocation.lng];
  const dropoff = [ride.dropoffLocation.lat, ride.dropoffLocation.lng];
  if (ride.status === 'accepted') {
    const line = ride.approachRoute?.coordinates ?? (position ? [[position.lat, position.lng], pickup] : null);
    if (!line) return null;
    return { key: `${ride.id}:pickup:${ride.approachRoute ? 'road' : 'straight'}`, kind: 'pickup', line, route: ride.approachRoute, target: pickup };
  }
  return { key: `${ride.id}:dropoff`, kind: 'dropoff', line: ride.route?.coordinates ?? [pickup, dropoff], route: ride.route, target: dropoff };
}

/** Ask for location access before going online in GPS mode. */
export function requestLocationPermission() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ ok: false, reason: 'unsupported' });
    if (!window.isSecureContext) return resolve({ ok: false, reason: 'insecure' });
    navigator.geolocation.getCurrentPosition(
      () => resolve({ ok: true }),
      (err) => resolve({ ok: false, reason: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

function startingPoint(initial, center) {
  if (initial?.lat != null && center && distanceM(initial, center) < 50_000) return { ...initial, at: Date.now() };
  if (!center) return null;
  const p = offset(center, 500 + Math.random() * 1500, Math.random() * 360);
  return { lat: p.lat, lng: p.lng, heading: null, at: Date.now() };
}

/**
 * Streams an online driver's position over the socket.
 *
 * mode 'simulated' (development): the position follows the current route and only moves
 * when the driver steps (Next/Back/auto-play/jump); a heartbeat re-sends it every 10 s.
 * Without a ride, the driver roams along a road route to a random nearby point.
 *
 * mode 'gps' (production): real device GPS only, with accuracy and jump filtering,
 * throttled sending, lost-signal detection and a screen wake lock.
 */
export function useDriverLocation({ socket, online, mode, ride, initial, center }) {
  const sim = mode === 'simulated';
  const [position, setPosition] = useState(() => (sim ? startingPoint(initial, center) : null));
  const posRef = useRef(position);
  const [error, setError] = useState(null);
  const [signalLost, setSignalLost] = useState(false);
  const [stepSize, setStepSize] = useState(100);
  const [autoplay, setAutoplay] = useState(false);
  const [speed, setSpeed] = useState(25);
  const [roam, setRoam] = useState(null);
  const [roamNonce, setRoamNonce] = useState(0);

  // Once the server config arrives, seed a simulated start point if we still have none.
  useEffect(() => {
    if (sim && !posRef.current && center) {
      posRef.current = startingPoint(initial, center);
      setPosition(posRef.current);
    }
  }, [sim, center, initial]);

  const send = useCallback(
    (p, simulated) => {
      if (!socket || !p) return;
      const payload = { lat: p.lat, lng: p.lng, simulated };
      if (p.heading != null) payload.heading = p.heading;
      if (p.accuracy != null) payload.accuracy = p.accuracy;
      socket.emit('driver:location', payload, (res) => {
        if (res?.ok) setError(null);
        else if (res?.reason && REJECTIONS[res.reason]) setError(REJECTIONS[res.reason]);
      });
    },
    [socket],
  );

  const leg = useMemo(() => activeLeg(ride, posRef.current), [ride]);
  const track = leg ?? (sim && online ? roam : null);
  const trackRef = useRef(track);
  trackRef.current = track;

  // Attach to a new track. Legs start where the driver is, so begin at 0 when they're near
  // the start: projecting instead can latch onto a later segment if the road doubles back.
  const trackState = useRef({ key: null, cum: [0], along: 0 });
  if (track && trackState.current.key !== track.key) {
    const cum = cumulative(track.line);
    const pos = posRef.current;
    const nearStart = pos && distanceM(pos, track.line[0]) <= START_SNAP_M;
    const pr = pos && !nearStart ? project(track.line, pos, cum) : null;
    trackState.current = { key: track.key, cum, along: pr?.along ?? 0, offRoute: nearStart ? 0 : (pr?.offRoute ?? 0) };
  }

  // ---------------------------------------------------------------- simulated mode

  const stepBy = useCallback(
    (delta) => {
      const t = trackRef.current;
      if (!t) return;
      const st = trackState.current;
      const total = st.cum.at(-1);
      st.along = Math.max(0, Math.min(total, st.along + delta));
      const p = pointAlong(t.line, st.along, st.cum);
      posRef.current = { lat: p.lat, lng: p.lng, heading: p.heading, at: Date.now() };
      setPosition(posRef.current);
      send(posRef.current, true);
      if (st.along >= total) {
        if (t.kind === 'roam') setRoamNonce((n) => n + 1);
        else setAutoplay(false);
      }
    },
    [send],
  );

  // A new leg that starts far from the simulated driver (e.g. the server placed them near
  // the pickup at accept time): snap onto the start of the leg.
  useEffect(() => {
    if (!sim || !track || !online) return;
    const st = trackState.current;
    if (st.offRoute > 300) {
      st.along = 0;
      st.offRoute = 0;
      stepBy(0);
    }
  }, [sim, track, online, stepBy]);

  // Roam to a random nearby point when online without a ride.
  useEffect(() => {
    if (!sim || !online || leg || !posRef.current) return undefined;
    let cancelled = false;
    const from = posRef.current;
    const to = offset(from, 700 + Math.random() * 1300, Math.random() * 360);
    api
      .geoRoute(from, to)
      .then(({ route }) => {
        if (!cancelled) setRoam({ key: `roam:${roamNonce}:${Date.now()}`, kind: 'roam', line: route.coordinates, route, target: route.coordinates.at(-1) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sim, online, leg, roamNonce]);

  useEffect(() => {
    if (!sim || !online || !autoplay) return undefined;
    const id = setInterval(() => stepBy(((speed / 3.6) * AUTOPLAY_MS) / 1000), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [sim, online, autoplay, speed, stepBy]);

  // Announce position on going online, then heartbeat so the map doesn't show "no signal".
  useEffect(() => {
    if (!sim || !online || !socket) return undefined;
    send(posRef.current, true);
    const id = setInterval(() => send(posRef.current, true), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [sim, online, socket, send]);

  useEffect(() => {
    if (!online) setAutoplay(false);
  }, [online]);

  // ---------------------------------------------------------------- gps mode

  useEffect(() => {
    if (sim || !online) return undefined;
    if (!('geolocation' in navigator)) {
      setError('This device has no GPS.');
      return undefined;
    }
    let lastFix = null;
    let lastSent = null;
    let lastFixAt = Date.now();
    setSignalLost(false);

    const watchId = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        lastFixAt = Date.now();
        setSignalLost(false);
        if (coords.accuracy > GPS_MAX_ACCURACY_M) {
          setError(`GPS accuracy is ${Math.round(coords.accuracy)} m. Waiting for a better fix…`);
          return;
        }
        const fix = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, at: timestamp };
        if (lastFix) {
          const hours = (fix.at - lastFix.at) / 3_600_000;
          const km = distanceM(lastFix, fix) / 1000;
          if (hours > 0 && hours < 5 / 60 && km > 0.05 && km / hours > GPS_MAX_SPEED_KMH) return; // glitch
          fix.heading = Number.isFinite(coords.heading) ? coords.heading : km > 0.005 ? bearing(lastFix, fix) : lastFix.heading;
        } else {
          fix.heading = Number.isFinite(coords.heading) ? coords.heading : null;
        }
        lastFix = fix;
        posRef.current = fix;
        setPosition(fix);
        setError(null);
        const now = Date.now();
        const due =
          !lastSent ||
          now - lastSent.at >= GPS_SEND_EVERY_MS ||
          (distanceM(lastSent, fix) >= GPS_SEND_DIST_M && now - lastSent.at >= GPS_MIN_GAP_MS);
        if (due) {
          send(fix, false);
          lastSent = { lat: fix.lat, lng: fix.lng, at: now };
        }
      },
      (err) => setError(err.code === err.PERMISSION_DENIED ? 'Location permission was turned off.' : 'Waiting for GPS…'),
      { enableHighAccuracy: true, maximumAge: 3_000, timeout: 20_000 },
    );
    const check = setInterval(() => setSignalLost(Date.now() - lastFixAt > SIGNAL_LOST_MS), 5_000);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(check);
    };
  }, [sim, online, send]);

  // Keep the screen on while online (phones throttle or pause GPS when asleep).
  useEffect(() => {
    if (!online || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    let released = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (released) lock.release().catch(() => {});
      } catch {
        /* denied or unsupported: not fatal */
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && acquire();
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [online]);

  // ---------------------------------------------------------------- progress (both modes)

  const progress = useMemo(() => {
    if (!track) return null;
    const st = trackState.current;
    const totalM = st.cum.at(-1);
    // GPS: project onto the leg, preferring the match nearest the previous progress.
    if (!sim && position) st.along = project(track.line, position, st.cum, st.along)?.along ?? st.along;
    const doneM = st.along;
    const remainingM = Math.max(0, totalM - doneM);
    // Arrived when near the pin, or at the end of the road route (a pin dropped in a park
    // ends the route on the nearest road, which can be more than 50 m away).
    const toTarget = position ? Math.min(distanceM(position, track.target), remainingM) : Infinity;
    return {
      kind: track.kind,
      line: track.line,
      doneM,
      totalM,
      remainingM,
      etaMin: etaMinutes(remainingM, track.route),
      arrived: track.kind !== 'roam' && toTarget <= ARRIVAL_RADIUS_M,
    };
    // `position` changes on every step/fix, which is what moves progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, position, sim]);

  return {
    mode,
    position,
    error,
    signalLost,
    progress,
    sim: sim
      ? {
          next: () => stepBy(stepSize),
          back: () => stepBy(-stepSize),
          jumpToEnd: () => stepBy(Infinity),
          stepSize,
          setStepSize,
          autoplay,
          setAutoplay,
          speed,
          setSpeed,
          ready: Boolean(track),
        }
      : null,
  };
}
