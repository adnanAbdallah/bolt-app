import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, Clock, Crosshair, Loader2, MapPin, Navigation, Phone, SignalZero, XCircle, Zap } from 'lucide-react';
import { api, formatMoney } from '../lib/api.js';
import { useAppConfig } from '../lib/appConfig.js';
import { etaMinutes } from '../lib/geo.js';
import { cumulative, project } from '../lib/geometry.js';
import { activeLeg } from '../lib/useDriverLocation.js';
import LazyMap from '../components/map/LazyMap.jsx';
import { PIN_SIZE, pinHtml, vehicleHtml } from '../components/map/markers.js';
import PlaceInput from '../components/PlaceInput.jsx';
import { usePolling } from '../lib/usePolling.js';
import { useOnReconnect, useSocketEvent } from '../context/SocketContext.jsx';
import ReportProblem from '../components/ReportProblem.jsx';
import Avatar from '../components/Avatar.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import RideProgress from '../components/RideProgress.jsx';
import RouteSummary from '../components/RouteSummary.jsx';
import Spinner from '../components/Spinner.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

// Live updates arrive over the socket; polling is only a safety net.
const FALLBACK_POLL_MS = 20000;

function FareQuote({ quote, loading }) {
  if (loading && !quote) {
    return (
      <div className="card flex items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (!quote) return null;
  const surging = quote.surgeMultiplier > 1;
  return (
    <div className={`card transition ${loading ? 'opacity-60' : ''}`}>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-gray-500">Moto · 1 seat</p>
          <p className="text-3xl font-bold">{formatMoney(quote.fare, quote.currency)}</p>
        </div>
        <div className="text-right text-sm text-gray-500">
          <p>{quote.distanceKm.toFixed(1)} km</p>
          <p className="flex items-center justify-end gap-1">
            <Clock className="h-3.5 w-3.5" /> ~{quote.durationMin} min
          </p>
        </div>
      </div>
      {surging && (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <Zap className="h-4 w-4" />
          High demand — fares are {quote.surgeMultiplier}× right now
        </p>
      )}
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
        <div>
          <dt>Base</dt>
          <dd className="font-medium text-gray-800">{formatMoney(quote.breakdown.base, quote.currency)}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd className="font-medium text-gray-800">{formatMoney(quote.breakdown.distance, quote.currency)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd className="font-medium text-gray-800">{formatMoney(quote.breakdown.time, quote.currency)}</dd>
        </div>
      </dl>
    </div>
  );
}

const SIGNAL_LOST_MS = 30_000;
const LEG_COLOR = { pickup: '#2563eb', dropoff: '#ea580c' };

function pinMarker(kind, place, extra = {}) {
  const [w, h, ax, ay] = PIN_SIZE[kind];
  return { id: kind, lat: place.lat, lng: place.lng, html: pinHtml(kind), size: [w, h], anchor: [ax, ay], tooltip: place.address, zIndex: kind === 'pickup' ? 500 : 400, ...extra };
}

/** Coordinates rounded so tiny re-renders don't trigger new estimates or re-framing. */
const placeKey = (p) => (p ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` : '');

function BookingForm({ onRequested }) {
  const config = useAppConfig();
  const [pickup, setPickup] = useState(null);
  const [dropoff, setDropoff] = useState(null);
  const [activeField, setActiveField] = useState('pickup');
  const [locating, setLocating] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const requestSeq = useRef(0);

  const setters = { pickup: setPickup, dropoff: setDropoff };

  /** Place a pin immediately, then fill in its address when the reverse lookup returns. */
  const placePin = useCallback(async (field, { lat, lng }) => {
    const pin = { address: 'Finding address…', lat, lng };
    setters[field](pin);
    try {
      const { place } = await api.geoReverse(lat, lng);
      setters[field]((cur) => (cur && cur.lat === lat && cur.lng === lng ? { ...place, lat, lng } : cur));
    } catch {
      setters[field]((cur) => (cur && cur.lat === lat && cur.lng === lng ? { ...cur, address: `Dropped pin (${lat.toFixed(5)}, ${lng.toFixed(5)})` } : cur));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = useCallback(() => {
    if (!('geolocation' in navigator)) return setError("This browser can't share your location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        await placePin('pickup', { lat: coords.latitude, lng: coords.longitude });
        setActiveField('dropoff');
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setError(err.code === err.PERMISSION_DENIED ? 'Location access is blocked. Type your pickup or tap the map instead.' : "Couldn't find your location. Type your pickup or tap the map.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }, [placePin]);

  // Default the pickup to the current location, but only if permission was already granted
  // (we don't pop a permission prompt the moment the page opens).
  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((st) => st.state === 'granted' && useMyLocation())
      .catch(() => {});
  }, [useMyLocation]);

  // Live fare estimate whenever both points are set (coordinates only; addresses don't change the price).
  const pk = placeKey(pickup);
  const dk = placeKey(dropoff);
  useEffect(() => {
    if (!pickup || !dropoff) {
      setQuote(null);
      return;
    }
    const seq = ++requestSeq.current;
    setQuoting(true);
    api
      .estimate(pickup, dropoff)
      .then((q) => seq === requestSeq.current && (setQuote(q), setError(null)))
      .catch((err) => seq === requestSeq.current && (setQuote(null), setError(err.message)))
      .finally(() => seq === requestSeq.current && setQuoting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pk, dk]);

  const onMapClick = useCallback(
    (latlng) => {
      const field = !pickup ? 'pickup' : !dropoff ? 'dropoff' : activeField;
      placePin(field, latlng);
      if (field === 'pickup') setActiveField('dropoff');
    },
    [pickup, dropoff, activeField, placePin],
  );

  const markers = useMemo(
    () => [
      pickup && pinMarker('pickup', pickup, { draggable: true, onDragEnd: (ll) => placePin('pickup', ll) }),
      dropoff && pinMarker('dropoff', dropoff, { draggable: true, onDragEnd: (ll) => placePin('dropoff', ll) }),
    ].filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickup, dropoff],
  );
  const lines = useMemo(() => (quote?.route ? [{ id: 'route', coords: quote.route.coordinates, color: '#2563eb', weight: 6 }] : []), [quote]);
  const fit = useMemo(() => {
    const pts = [pickup && [pickup.lat, pickup.lng], dropoff && [dropoff.lat, dropoff.lng]].filter(Boolean);
    return pts.length ? { key: `${pk}|${dk}`, points: pts, maxZoom: 16 } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pk, dk]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pickup || !dropoff) return;
    setSubmitting(true);
    setError(null);
    try {
      const { ride } = await api.requestRide(pickup, dropoff);
      onRequested(ride);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const nextTap = !pickup ? 'pickup' : !dropoff ? 'dropoff' : activeField;
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h1 className="text-2xl font-bold">Where to?</h1>
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="card space-y-3">
        <PlaceInput
          id="pickup"
          label="Pickup location"
          placeholder="Pickup location"
          icon={<Circle className="h-4 w-4 fill-brand-500 text-brand-500" />}
          place={pickup}
          onSelect={setPickup}
          onFocus={() => setActiveField('pickup')}
          near={pickup ?? config?.map.center}
          action={
            <button type="button" onClick={useMyLocation} disabled={locating} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-brand-700" title="Use my current location" aria-label="Use my current location">
              {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
            </button>
          }
        />
        <PlaceInput
          id="dropoff"
          label="Dropoff location"
          placeholder="Where are you going?"
          icon={<MapPin className="h-4 w-4 text-red-500" />}
          place={dropoff}
          onSelect={setDropoff}
          onFocus={() => setActiveField('dropoff')}
          near={pickup ?? config?.map.center}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 shadow-sm">
        <LazyMap markers={markers} lines={lines} fit={fit} onMapClick={onMapClick} className="h-64 w-full sm:h-80" label="Choose pickup and dropoff on the map" />
        <p className="flex items-center gap-1.5 bg-white px-4 py-2 text-xs text-gray-500">
          <MapPin className="h-3.5 w-3.5" /> Tap the map to set your <b className="font-semibold text-gray-700">{nextTap}</b>. Drag a pin to adjust it.
        </p>
      </div>

      <FareQuote quote={quote} loading={quoting} />

      <button className="btn-primary w-full text-lg" disabled={!quote || quoting || submitting}>
        {submitting ? <Spinner className="text-white" /> : <Navigation className="h-5 w-5" />}
        Request Ride
      </button>
    </form>
  );
}

/** Live map for an active ride: route, pickup/dropoff and the driver gliding along. */
function RideMap({ ride, driverLocation }) {
  const live = ['accepted', 'ongoing'].includes(ride.status);
  const leg = useMemo(() => (live ? activeLeg(ride, driverLocation) : null), [live, ride, driverLocation]);

  const markers = useMemo(() => {
    const list = [pinMarker('pickup', ride.pickupLocation), pinMarker('dropoff', ride.dropoffLocation)];
    if (live && driverLocation) {
      const color = LEG_COLOR[leg?.kind] ?? '#16a34a';
      list.push({
        id: 'driver',
        lat: driverLocation.lat,
        lng: driverLocation.lng,
        html: vehicleHtml({ color, glyph: ride.status === 'ongoing' ? 'person' : 'nav', size: 30, showHeading: driverLocation.heading != null }),
        size: [30, 30],
        rotation: driverLocation.heading ?? null,
        animate: true,
        zIndex: 1000,
        tooltip: ride.driver?.name ?? 'Your rider',
      });
    }
    return list;
  }, [ride, driverLocation, live, leg?.kind]);

  const lines = useMemo(() => {
    const trip = ride.route?.coordinates ?? [[ride.pickupLocation.lat, ride.pickupLocation.lng], [ride.dropoffLocation.lat, ride.dropoffLocation.lng]];
    if (ride.status === 'accepted') {
      const out = [{ id: 'trip', coords: trip, color: '#6b7280', weight: 4, opacity: 0.6, dashArray: '8 8' }];
      if (leg) out.push({ id: 'leg', coords: leg.line, color: LEG_COLOR.pickup, weight: 6 });
      return out;
    }
    return [{ id: 'trip', coords: trip, color: ride.status === 'ongoing' ? LEG_COLOR.dropoff : '#6b7280', weight: ride.status === 'ongoing' ? 6 : 4, dashArray: ride.status === 'ongoing' ? null : '8 8' }];
  }, [ride, leg]);

  const fit = useMemo(() => {
    const pts = [[ride.pickupLocation.lat, ride.pickupLocation.lng]];
    if (ride.status !== 'accepted') pts.push([ride.dropoffLocation.lat, ride.dropoffLocation.lng]);
    if (live && driverLocation) pts.push([driverLocation.lat, driverLocation.lng]);
    return { key: `${ride.id}:${ride.status}:${Boolean(driverLocation)}`, points: pts };
    // re-frame on status changes, not on every position update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride.id, ride.status, Boolean(driverLocation)]);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 shadow-sm">
      <LazyMap markers={markers} lines={lines} fit={fit} className="h-64 w-full sm:h-80" label="Your ride on the map" />
    </div>
  );
}

/** "Arriving in N min" from the driver's position projected onto the current leg. */
function useDriverEta(ride, driverLocation) {
  const [, tick] = useState(0);
  const last = useRef({ key: null, along: 0 }); // previous position on this leg, to follow out-and-back roads
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  // Cheap enough to recompute each render; the 5 s tick keeps "No recent signal" honest.
  if (!driverLocation || !['accepted', 'ongoing'].includes(ride.status)) return null;
  const leg = activeLeg(ride, driverLocation);
  if (!leg) return null;
  const cum = cumulative(leg.line);
  if (last.current.key !== leg.key) last.current = { key: leg.key, along: 0 };
  const done = project(leg.line, driverLocation, cum, last.current.along)?.along ?? 0;
  last.current.along = done;
  const remainingM = Math.max(0, cum.at(-1) - done);
  const stale = Date.now() - new Date(driverLocation.updatedAt ?? Date.now()) > SIGNAL_LOST_MS;
  return { remainingM, etaMin: etaMinutes(remainingM, leg.route), stale };
}

function ActiveRide({ ride, driverLocation, onCancel, onDone, onChange, busy }) {
  const finished = ride.status === 'completed' || ride.status === 'cancelled';
  const eta = useDriverEta(ride, driverLocation);
  const headline = {
    requested: 'Finding you a rider…',
    accepted: 'Your rider is on the way',
    ongoing: 'Enjoy the ride',
    completed: 'You have arrived',
    cancelled: 'Ride cancelled',
  }[ride.status];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{headline}</h1>
          {eta && !eta.stale && (
            <p className="text-sm font-medium text-gray-600" aria-live="polite">
              {ride.status === 'accepted'
                ? eta.remainingM < 60 ? 'Your rider has arrived at the pickup' : `Arriving in ${eta.etaMin} min`
                : eta.remainingM < 60 ? 'Almost there' : `${eta.etaMin} min to your destination`}
            </p>
          )}
          {eta?.stale && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700">
              <SignalZero className="h-4 w-4" /> No recent signal from your rider
            </p>
          )}
          {ride.status === 'accepted' && !driverLocation && <p className="text-sm text-gray-500">Waiting for your rider's location…</p>}
        </div>
        <StatusBadge status={ride.status} />
      </div>

      {ride.status !== 'cancelled' && <RideMap ride={ride} driverLocation={driverLocation} />}

      {ride.status !== 'cancelled' && (
        <div className="card">
          <RideProgress status={ride.status} />
        </div>
      )}

      {ride.status === 'requested' && (
        <div className="card flex items-center gap-3 text-sm text-gray-600">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-brand-500" />
          </span>
          Looking for nearby drivers. This usually takes under a minute.
        </div>
      )}

      {ride.driver && (
        <div className="card flex items-center gap-4">
          <Avatar user={ride.driver} size="h-12 w-12" />
          <div className="flex-1">
            <p className="font-semibold">{ride.driver.name}</p>
            <p className="text-sm text-gray-500">
              {ride.driver.vehicle?.plate
                ? `${ride.driver.vehicle.make ?? ''} ${ride.driver.vehicle.model ?? ''} · ${ride.driver.vehicle.plate}`
                : 'Motorcycle'}
            </p>
          </div>
          {ride.driver.phone && (
            <a href={`tel:${ride.driver.phone}`} className="rounded-full bg-brand-50 p-3 text-brand-700">
              <Phone className="h-5 w-5" />
            </a>
          )}
        </div>
      )}

      <div className="card space-y-4">
        <RouteSummary pickup={ride.pickupLocation.address} dropoff={ride.dropoffLocation.address} />
        <div className="flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="text-sm text-gray-500">
            {ride.distanceKm?.toFixed(1)} km · ~{ride.durationMin} min
          </span>
          <span className="text-lg font-bold">{formatMoney(ride.fare, ride.currency)}</span>
        </div>
      </div>

      {(ride.status === 'requested' || ride.status === 'accepted') && (
        <button onClick={onCancel} disabled={busy} className="btn-danger w-full">
          <XCircle className="h-5 w-5" /> Cancel ride
        </button>
      )}
      {/* Reportable: finished trips, and rides the driver cancelled (e.g. no-shows). */}
      {(ride.status === 'completed' || ride.cancelledBy === 'driver') && (
        <ReportProblem ride={ride} onReported={onChange} exclude={['passenger_behavior']} />
      )}
      {finished && (
        <button onClick={onDone} className="btn-primary w-full">
          <CheckCircle2 className="h-5 w-5" /> Book another ride
        </button>
      )}
    </div>
  );
}

export default function PassengerHome() {
  const [ride, setRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const rideRef = useRef(null);
  rideRef.current = ride;

  const poll = useCallback(async () => {
    try {
      const { ride: active } = await api.activeRide();
      const prev = rideRef.current;
      if (active) {
        setRide(active);
        if (active.driverLocation) setDriverLocation(active.driverLocation);
      } else if (prev && !['completed', 'cancelled'].includes(prev.status)) {
        // The ride just left an active state; fetch its final version to show the outcome.
        const { rides } = await api.history();
        setRide(rides.find((r) => r.id === prev.id) ?? null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const shouldPoll = loading || (ride && !['completed', 'cancelled'].includes(ride.status));
  usePolling(poll, FALLBACK_POLL_MS, shouldPoll);
  useOnReconnect(poll);
  useSocketEvent('ride:updated', ({ ride: updated }) => {
    const current = rideRef.current;
    if (!current || current.id === updated.id) setRide(updated);
  });
  // The server sends this only to the passenger of the driver's active ride.
  useSocketEvent('ride:driver-location', ({ rideId, location }) => {
    if (rideRef.current?.id === rideId) setDriverLocation(location);
  });
  useEffect(() => {
    if (!ride || !['accepted', 'ongoing'].includes(ride.status)) setDriverLocation(null);
  }, [ride?.id, ride?.status]);

  const handleCancel = async () => {
    if (!confirm('Cancel this ride?')) return;
    setBusy(true);
    try {
      const { ride: updated } = await api.cancelRide(ride.id);
      setRide(updated);
    } catch (err) {
      setError(err.message);
      poll();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner fullScreen />;

  return (
    <>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      {ride ? (
        <ActiveRide ride={ride} driverLocation={driverLocation} busy={busy} onCancel={handleCancel} onChange={setRide} onDone={() => setRide(null)} />
      ) : (
        <BookingForm onRequested={setRide} />
      )}
    </>
  );
}
