import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Clock, MapPin, Navigation, Phone, XCircle, Zap } from 'lucide-react';
import { api, formatMoney } from '../lib/api.js';
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

function BookingForm({ onRequested }) {
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const requestSeq = useRef(0);

  // Debounced live fare estimate whenever both addresses are filled in.
  useEffect(() => {
    const p = pickup.trim();
    const d = dropoff.trim();
    if (!p || !d) {
      setQuote(null);
      return undefined;
    }
    const seq = ++requestSeq.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await api.estimate(p, d);
        if (seq === requestSeq.current) {
          setQuote(q);
          setError(null);
        }
      } catch (err) {
        if (seq === requestSeq.current) {
          setQuote(null);
          setError(err.message);
        }
      } finally {
        if (seq === requestSeq.current) setQuoting(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [pickup, dropoff]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { ride } = await api.requestRide(pickup.trim(), dropoff.trim());
      onRequested(ride);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h1 className="text-2xl font-bold">Where to?</h1>
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="card space-y-3">
        <label className="relative block">
          <span className="sr-only">Pickup location</span>
          <Circle className="absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 fill-brand-500 text-brand-500" />
          <input
            className="input"
            placeholder="Pickup location"
            value={pickup}
            onChange={(e) => setPickup(e.target.value)}
            maxLength={200}
            autoComplete="off"
            required
          />
        </label>
        <label className="relative block">
          <span className="sr-only">Dropoff location</span>
          <MapPin className="absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-red-500" />
          <input
            className="input"
            placeholder="Where are you going?"
            value={dropoff}
            onChange={(e) => setDropoff(e.target.value)}
            maxLength={200}
            autoComplete="off"
            required
          />
        </label>
      </div>

      <FareQuote quote={quote} loading={quoting} />

      <button className="btn-primary w-full text-lg" disabled={!quote || quoting || submitting}>
        {submitting ? <Spinner className="text-white" /> : <Navigation className="h-5 w-5" />}
        Request Ride
      </button>
    </form>
  );
}

function ActiveRide({ ride, onCancel, onDone, onChange, busy }) {
  const finished = ride.status === 'completed' || ride.status === 'cancelled';
  const headline = {
    requested: 'Finding you a rider…',
    accepted: 'Your rider is on the way',
    ongoing: 'Enjoy the ride',
    completed: 'You have arrived',
    cancelled: 'Ride cancelled',
  }[ride.status];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{headline}</h1>
        <StatusBadge status={ride.status} />
      </div>

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
  const rideRef = useRef(null);
  rideRef.current = ride;

  const poll = useCallback(async () => {
    try {
      const { ride: active } = await api.activeRide();
      const prev = rideRef.current;
      if (active) {
        setRide(active);
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
        <ActiveRide ride={ride} busy={busy} onCancel={handleCancel} onChange={setRide} onDone={() => setRide(null)} />
      ) : (
        <BookingForm onRequested={setRide} />
      )}
    </>
  );
}
