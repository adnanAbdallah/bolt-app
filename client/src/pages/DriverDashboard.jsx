import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Inbox, Play, Power, Wallet, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api, formatMoney } from '../lib/api.js';
import { usePolling } from '../lib/usePolling.js';
import Avatar from '../components/Avatar.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import RideProgress from '../components/RideProgress.jsx';
import RouteSummary from '../components/RouteSummary.jsx';
import Spinner from '../components/Spinner.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const POLL_MS = 4000;

const timeAgo = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

function OnlineToggle({ isOnline, onToggle, busy }) {
  return (
    <div className={`card flex items-center justify-between ${isOnline ? 'border-brand-100 bg-brand-50' : ''}`}>
      <div>
        <p className="font-semibold">{isOnline ? "You're online" : "You're offline"}</p>
        <p className="text-sm text-gray-500">
          {isOnline ? 'Receiving ride requests nearby' : 'Go online to start receiving requests'}
        </p>
      </div>
      <button
        onClick={onToggle}
        disabled={busy}
        role="switch"
        aria-checked={isOnline}
        className={`relative h-9 w-16 rounded-full transition disabled:opacity-50 ${isOnline ? 'bg-brand-500' : 'bg-gray-300'}`}
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

function CurrentTrip({ ride, onStart, onComplete, onCancel, busy }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{ride.status === 'accepted' ? 'Pick up passenger' : 'Trip in progress'}</h2>
        <StatusBadge status={ride.status} />
      </div>
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
  const isOnline = Boolean(user?.isOnline);

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

  // Poll for new requests while online, and for passenger cancellations while on a trip.
  usePolling(refresh, POLL_MS, isOnline || Boolean(activeRide) || loading);

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

  if (loading) return <Spinner fullScreen />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <OnlineToggle isOnline={isOnline} onToggle={toggleOnline} busy={busy || Boolean(activeRide)} />

      {activeRide ? (
        <CurrentTrip ride={activeRide} busy={busy} onStart={start} onComplete={complete} onCancel={cancel} />
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
