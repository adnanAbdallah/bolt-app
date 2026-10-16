import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FastForward,
  Inbox,
  LocateFixed,
  Navigation,
  Pause,
  Play,
  Power,
  SignalZero,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useOnReconnect, useSocket, useSocketEvent } from '../context/SocketContext.jsx';
import { api, formatMoney, timeAgo } from '../lib/api.js';
import { useAppConfig } from '../lib/appConfig.js';
import { formatKm, navigationUrl } from '../lib/geo.js';
import { usePolling } from '../lib/usePolling.js';
import { AUTOPLAY_SPEEDS, STEP_SIZES, requestLocationPermission, useDriverLocation } from '../lib/useDriverLocation.js';
import DriverDocuments from '../components/DriverDocuments.jsx';
import LazyMap from '../components/map/LazyMap.jsx';
import { PIN_SIZE, pinHtml, vehicleHtml } from '../components/map/markers.js';
import Avatar from '../components/Avatar.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import RideProgress from '../components/RideProgress.jsx';
import RouteSummary from '../components/RouteSummary.jsx';
import Spinner from '../components/Spinner.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

// New requests and cancellations arrive over the socket; polling is only a safety net.
const FALLBACK_POLL_MS = 20000;

const LEG_COLOR = { pickup: '#2563eb', dropoff: '#ea580c', roam: '#16a34a' };

function LocationStatus({ location }) {
  const { mode, position, error, signalLost } = location;
  if (mode === 'simulated') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
        <LocateFixed className="h-3.5 w-3.5 text-brand-600" /> Dev mode · simulated location
      </p>
    );
  }
  if (signalLost) {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-700">
        <SignalZero className="h-3.5 w-3.5" /> No GPS signal for 30 s. Passengers see "No recent signal".
      </p>
    );
  }
  return (
    <p className={`mt-1 flex items-center gap-1.5 text-xs ${error ? 'text-amber-700' : 'text-gray-500'}`}>
      <LocateFixed className={`h-3.5 w-3.5 ${position && !error ? 'text-brand-600' : ''}`} />
      {error ?? (position ? `Sharing GPS location (±${Math.round(position.accuracy ?? 0)} m)` : 'Waiting for GPS…')}
    </p>
  );
}

function OnlineToggle({ isOnline, onToggle, busy, location }) {
  return (
    <div className={`card flex items-center justify-between gap-3 ${isOnline ? 'border-brand-100 bg-brand-50' : ''}`}>
      <div className="min-w-0">
        <p className="font-semibold">{isOnline ? "You're online" : "You're offline"}</p>
        <p className="text-sm text-gray-500">
          {isOnline ? 'Receiving ride requests nearby' : 'Go online to start receiving requests'}
        </p>
        {isOnline && <LocationStatus location={location} />}
      </div>
      <button
        onClick={onToggle}
        disabled={busy}
        role="switch"
        aria-checked={isOnline}
        aria-label={isOnline ? 'Go offline' : 'Go online'}
        className={`relative h-9 w-16 shrink-0 rounded-full transition disabled:opacity-50 ${isOnline ? 'bg-brand-500' : 'bg-gray-300'}`}
      >
        <span
          className={`absolute top-1 left-1 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow transition-transform ${
            isOnline ? 'translate-x-7' : ''
          }`}
        >
          <Power className={`h-4 w-4 ${isOnline ? 'text-brand-600' : 'text-gray-400'}`} />
        </span>
      </button>
    </div>
  );
}

const PERMISSION_HELP = {
  denied: 'Location access is blocked. Click the lock icon next to the address bar, allow Location for this site, then try again. On a phone, also check Settings → Privacy → Location for your browser.',
  unavailable: "We couldn't get a GPS fix. Make sure location services are on and try again near a window or outdoors.",
  unsupported: "This browser can't share location. Use a recent Chrome, Safari or Firefox on your phone.",
  insecure: 'Location only works over HTTPS. Open the app through its https:// address.',
};

function PermissionHelp({ reason, onRetry, onClose }) {
  return (
    <div className="card space-y-3 border-amber-200 bg-amber-50">
      <p className="font-semibold text-amber-900">Location is required to go online</p>
      <p className="text-sm text-amber-900">
        Passengers follow your position on their map while you drive to them, and support uses your route to resolve disputes.
        Your location is shared only while you're online.
      </p>
      <p className="text-sm text-gray-700">{PERMISSION_HELP[reason] ?? PERMISSION_HELP.unavailable}</p>
      <div className="flex gap-2">
        <button onClick={onRetry} className="btn-primary px-4 py-2 text-sm">Try again</button>
        <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Not now</button>
      </div>
    </div>
  );
}

function DriverMap({ location, ride, requests }) {
  const { position, progress } = location;
  const leg = progress?.kind ?? null;

  const markers = useMemo(() => {
    const list = [];
    if (position) {
      const color = LEG_COLOR[leg] ?? LEG_COLOR.roam;
      list.push({
        id: 'me',
        lat: position.lat,
        lng: position.lng,
        html: vehicleHtml({ color, glyph: leg === 'dropoff' ? 'person' : leg === 'pickup' ? 'nav' : 'bike', size: 30, showHeading: position.heading != null }),
        size: [30, 30],
        rotation: position.heading ?? null,
        animate: true,
        zIndex: 1000,
        tooltip: 'You',
      });
    }
    if (ride) {
      const [w, h, ax, ay] = PIN_SIZE.dropoff;
      list.push({ id: 'pickup', lat: ride.pickupLocation.lat, lng: ride.pickupLocation.lng, html: pinHtml('pickup'), size: PIN_SIZE.pickup.slice(0, 2), anchor: PIN_SIZE.pickup.slice(2), tooltip: `Pickup: ${ride.pickupLocation.address}` });
      list.push({ id: 'dropoff', lat: ride.dropoffLocation.lat, lng: ride.dropoffLocation.lng, html: pinHtml('dropoff'), size: [w, h], anchor: [ax, ay], tooltip: `Dropoff: ${ride.dropoffLocation.address}` });
    } else {
      for (const r of requests) {
        const [w, h, ax, ay] = PIN_SIZE.dropoff;
        list.push({ id: `req-drop-${r.id}`, lat: r.dropoffLocation.lat, lng: r.dropoffLocation.lng, html: pinHtml('dropoff'), size: [w, h], anchor: [ax, ay], tooltip: `${r.passenger?.name ?? 'Request'} → ${r.dropoffLocation.address}` });
      }
    }
    return list;
  }, [position, ride, requests, leg]);

  const circles = useMemo(
    () =>
      ride
        ? []
        : requests
            .filter((r) => r.pickupLocation.lat != null)
            .map((r) => ({ id: `req-${r.id}`, lat: r.pickupLocation.lat, lng: r.pickupLocation.lng, radius: r.pickupLocation.radiusM ?? 600, color: '#d97706', tooltip: `${r.pickupLocation.address} · ${formatMoney(r.fare, r.currency)}` })),
    [ride, requests],
  );

  const lines = useMemo(() => {
    const out = [];
    if (progress?.line) out.push({ id: 'leg', coords: progress.line, color: LEG_COLOR[leg], weight: leg === 'roam' ? 4 : 6, opacity: leg === 'roam' ? 0.5 : 0.9, dashArray: leg === 'roam' ? '2 8' : null });
    // While heading to the pickup, preview the trip itself.
    if (ride?.status === 'accepted') {
      const trip = ride.route?.coordinates ?? [[ride.pickupLocation.lat, ride.pickupLocation.lng], [ride.dropoffLocation.lat, ride.dropoffLocation.lng]];
      out.push({ id: 'next', coords: trip, color: '#6b7280', weight: 4, opacity: 0.6, dashArray: '8 8' });
    }
    return out;
  }, [progress?.line, leg, ride]);

  const fit = useMemo(() => {
    if (ride) {
      const pts = [position && [position.lat, position.lng], [ride.pickupLocation.lat, ride.pickupLocation.lng]];
      if (ride.status === 'ongoing') pts.push([ride.dropoffLocation.lat, ride.dropoffLocation.lng]);
      return { key: `${ride.id}:${ride.status}`, points: pts.filter(Boolean) };
    }
    if (requests.length) return { key: `req:${requests.map((r) => r.id).join(',')}`, points: [position && [position.lat, position.lng], ...requests.map((r) => [r.pickupLocation.lat, r.pickupLocation.lng])].filter(Boolean) };
    return position ? { key: 'me', points: [[position.lat, position.lng]], maxZoom: 15 } : null;
    // re-frame only when the situation changes, not on every position update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride?.id, ride?.status, requests, Boolean(position)]);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 shadow-sm">
      <LazyMap markers={markers} lines={lines} circles={circles} fit={fit} className="h-64 w-full sm:h-80" label="Your position and route" />
    </div>
  );
}

function DevPanel({ location }) {
  const { sim, progress } = location;
  if (!sim) return null;
  const legLabel = { pickup: 'to pickup', dropoff: 'to dropoff', roam: 'cruising' }[progress?.kind] ?? '';
  return (
    <section className="card space-y-3 border-dashed border-violet-300 bg-violet-50/60" aria-label="Dev mode location controls">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold tracking-wide text-violet-700 uppercase">Dev mode · move along the road</p>
        {progress ? (
          <p className="text-xs text-gray-600 tabular-nums">
            {formatKm(progress.doneM)} of {formatKm(progress.totalM)} {legLabel}
            {progress.kind !== 'roam' && ` · ETA ${progress.remainingM < 20 ? 'now' : `${progress.etaMin} min`}`}
          </p>
        ) : (
          <p className="text-xs text-gray-500">Finding a route…</p>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-violet-100" aria-hidden="true">
        <div className="h-full rounded-full bg-violet-500 transition-[width]" style={{ width: `${progress?.totalM ? (progress.doneM / progress.totalM) * 100 : 0}%` }} />
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <button onClick={sim.back} disabled={!sim.ready} className="btn-secondary px-3" aria-label={`Back ${sim.stepSize} metres`}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button onClick={sim.next} disabled={!sim.ready} className="btn bg-violet-600 text-white hover:bg-violet-700">
          Next {sim.stepSize} m <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-gray-600">Step</span>
          <select id="dev-step" value={sim.stepSize} onChange={(e) => sim.setStepSize(Number(e.target.value))} className="rounded-lg border border-gray-200 bg-white px-2 py-1">
            {STEP_SIZES.map((m) => <option key={m} value={m}>{m} m</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-gray-600">Speed</span>
          <select id="dev-speed" value={sim.speed} onChange={(e) => sim.setSpeed(Number(e.target.value))} className="rounded-lg border border-gray-200 bg-white px-2 py-1">
            {AUTOPLAY_SPEEDS.map((v) => <option key={v} value={v}>{v} km/h</option>)}
          </select>
        </label>
        <button onClick={() => sim.setAutoplay(!sim.autoplay)} disabled={!sim.ready} className="btn-secondary px-3 py-1.5 text-sm" aria-pressed={sim.autoplay}>
          {sim.autoplay ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {sim.autoplay ? 'Pause' : 'Auto-play'}
        </button>
        {progress && progress.kind !== 'roam' && (
          <button onClick={sim.jumpToEnd} className="btn-secondary px-3 py-1.5 text-sm">
            <FastForward className="h-4 w-4" /> Jump to {progress.kind}
          </button>
        )}
      </div>
    </section>
  );
}

function Earnings({ history }) {
  const today = new Date().toDateString();
  const completedToday = history.filter(
    (r) => r.status === 'completed' && new Date(r.completedAt).toDateString() === today,
  );
  const total = completedToday.reduce((sum, r) => sum + r.fare, 0);
  const currency = history[0]?.currency ?? 'USD';
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="card">
        <Wallet className="mb-2 h-5 w-5 text-brand-600" />
        <p className="text-2xl font-bold">{formatMoney(total, currency)}</p>
        <p className="text-xs text-gray-500">Earned today</p>
      </div>
      <div className="card">
        <CheckCircle2 className="mb-2 h-5 w-5 text-brand-600" />
        <p className="text-2xl font-bold">{completedToday.length}</p>
        <p className="text-xs text-gray-500">Trips today</p>
      </div>
    </div>
  );
}

function RequestCard({ ride, onAccept, busy }) {
  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar user={ride.passenger} />
          <div>
            <p className="font-semibold">{ride.passenger?.name ?? 'Passenger'}</p>
            <p className="flex items-center gap-1 text-xs text-gray-500">
              <Clock className="h-3 w-3" /> {timeAgo(ride.createdAt)}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold">{formatMoney(ride.fare, ride.currency)}</p>
          <p className="text-xs text-gray-500">
            {ride.distanceKm?.toFixed(1)} km{ride.surgeMultiplier > 1 && ` · ${ride.surgeMultiplier}×`}
          </p>
        </div>
      </div>
      <RouteSummary pickup={ride.pickupLocation.address} dropoff={ride.dropoffLocation.address} />
      <button onClick={() => onAccept(ride.id)} disabled={busy} className="btn-primary w-full">
        Accept ride
      </button>
    </div>
  );
}

function CurrentTrip({ ride, progress, onStart, onComplete, onCancel, busy }) {
  const target = ride.status === 'accepted' ? ride.pickupLocation : ride.dropoffLocation;
  const arrived = progress?.arrived;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{ride.status === 'accepted' ? 'Pick up passenger' : 'Trip in progress'}</h2>
          {progress && !arrived && (
            <p className="text-sm text-gray-500 tabular-nums">
              {formatKm(progress.remainingM)} to {ride.status === 'accepted' ? 'pickup' : 'dropoff'} · about {progress.etaMin} min
            </p>
          )}
        </div>
        <StatusBadge status={ride.status} />
      </div>

      {arrived && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-brand-100 bg-brand-50">
          <p className="font-semibold text-brand-700">
            {ride.status === 'accepted' ? 'Arrived at pickup' : 'Arrived at dropoff'}
          </p>
          {ride.status === 'accepted' ? (
            <button onClick={onStart} disabled={busy} className="btn-primary px-4 py-2">
              <Play className="h-4 w-4" /> Start trip
            </button>
          ) : (
            <button onClick={onComplete} disabled={busy} className="btn-primary px-4 py-2">
              <CheckCircle2 className="h-4 w-4" /> Complete trip
            </button>
          )}
        </div>
      )}
      <div className="card">
        <RideProgress status={ride.status} />
      </div>
      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <Avatar user={ride.passenger} size="h-11 w-11" />
          <div className="flex-1">
            <p className="font-semibold">{ride.passenger?.name}</p>
            {ride.passenger?.phone && (
              <a href={`tel:${ride.passenger.phone}`} className="text-sm text-brand-700">
                {ride.passenger.phone}
              </a>
            )}
          </div>
          <p className="text-xl font-bold">{formatMoney(ride.fare, ride.currency)}</p>
        </div>
        <RouteSummary pickup={ride.pickupLocation.address} dropoff={ride.dropoffLocation.address} />
        <a href={navigationUrl(target)} target="_blank" rel="noopener noreferrer" className="btn-secondary w-full text-sm">
          <Navigation className="h-4 w-4" /> Navigate to {ride.status === 'accepted' ? 'pickup' : 'dropoff'}
        </a>
      </div>
      {ride.status === 'accepted' && (
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <button onClick={onCancel} disabled={busy} className="btn-danger">
            <XCircle className="h-5 w-5" /> Cancel
          </button>
          <button onClick={onStart} disabled={busy} className="btn-primary">
            <Play className="h-5 w-5" /> Start trip
          </button>
        </div>
      )}
      {ride.status === 'ongoing' && (
        <button onClick={onComplete} disabled={busy} className="btn-primary w-full text-lg">
          <CheckCircle2 className="h-5 w-5" /> Complete trip
        </button>
      )}
    </div>
  );
}

export default function DriverDashboard() {
  const { user, setUser } = useAuth();
  const [activeRide, setActiveRide] = useState(null);
  const [requests, setRequests] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [permissionProblem, setPermissionProblem] = useState(null);
  const isOnline = Boolean(user?.isOnline);
  const config = useAppConfig();

  const loadHistory = useCallback(() => api.history().then(({ rides }) => setHistory(rides)), []);

  const refresh = useCallback(async () => {
    try {
      const { ride } = await api.activeRide();
      setActiveRide(ride);
      if (!ride && isOnline) {
        const { rides } = await api.availableRides();
        setRequests(rides);
      } else {
        setRequests([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => {
    loadHistory().catch(() => {});
  }, [loadHistory]);

  usePolling(refresh, FALLBACK_POLL_MS, isOnline || Boolean(activeRide) || loading);
  useOnReconnect(refresh);
  useSocketEvent('rides:changed', () => {
    if (isOnline && !activeRide) refresh();
  });
  useSocketEvent('ride:updated', ({ ride }) => {
    if (activeRide?.id !== ride.id) return;
    if (ride.status === 'completed' || ride.status === 'cancelled') {
      setActiveRide(null);
      loadHistory().catch(() => {});
      if (ride.cancelledBy === 'passenger') setError('The passenger cancelled this ride.');
      if (ride.cancelledBy === 'admin') setError('Support closed this ride.');
    } else {
      setActiveRide(ride);
    }
  });

  const { socket } = useSocket();
  const location = useDriverLocation({
    socket,
    online: isOnline,
    mode: config?.locationMode,
    ride: activeRide,
    initial: user?.location,
    center: config?.map.center,
  });

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const toggleOnline = () =>
    run(async () => {
      // Production: real GPS is mandatory, so check permission before going online.
      if (!isOnline && config?.locationMode === 'gps') {
        const check = await requestLocationPermission();
        if (!check.ok) {
          setPermissionProblem(check.reason);
          return;
        }
      }
      setPermissionProblem(null);
      const { user: updated } = await api.setOnline(!isOnline);
      setUser(updated);
    });

  const accept = (id) =>
    run(async () => {
      const { ride } = await api.acceptRide(id);
      setActiveRide(ride);
      setRequests([]);
    });

  const start = () => run(async () => setActiveRide((await api.startRide(activeRide.id)).ride));

  const complete = () =>
    run(async () => {
      await api.completeRide(activeRide.id);
      setActiveRide(null);
      await loadHistory();
    });

  const cancel = () => {
    if (!confirm('Cancel this ride? The passenger will need to request again.')) return;
    run(async () => {
      await api.cancelRide(activeRide.id);
      setActiveRide(null);
    });
  };

  if (loading || !config) return <Spinner fullScreen />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onClose={() => setError(null)} />
      {!user.verified && <DriverDocuments user={user} onUpdated={setUser} />}
      <OnlineToggle
        isOnline={isOnline}
        onToggle={toggleOnline}
        busy={busy || Boolean(activeRide)}
        location={location}
      />
      {permissionProblem && (
        <PermissionHelp reason={permissionProblem} onRetry={toggleOnline} onClose={() => setPermissionProblem(null)} />
      )}

      {(isOnline || activeRide) && <DriverMap location={location} ride={activeRide} requests={requests} />}
      {isOnline && <DevPanel location={location} />}

      {activeRide ? (
        <CurrentTrip ride={activeRide} progress={location.progress} busy={busy} onStart={start} onComplete={complete} onCancel={cancel} />
      ) : (
        <>
          <Earnings history={history} />
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              Incoming requests
              {requests.length > 0 && (
                <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs text-white">{requests.length}</span>
              )}
            </h2>
            {!isOnline ? (
              <p className="card text-center text-sm text-gray-500">You're offline.</p>
            ) : requests.length === 0 ? (
              <div className="card flex flex-col items-center gap-2 py-10 text-gray-400">
                <Inbox className="h-8 w-8" />
                <p className="text-sm">Waiting for ride requests…</p>
              </div>
            ) : (
              requests.map((r) => <RequestCard key={r.id} ride={r} onAccept={accept} busy={busy} />)
            )}
          </section>
        </>
      )}
    </div>
  );
}
