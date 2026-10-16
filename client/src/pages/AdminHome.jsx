import { useCallback, useState } from 'react';
import { api, formatMoney } from '../lib/api.js';
import { usePolling } from '../lib/usePolling.js';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Spinner from '../components/Spinner.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

export default function AdminHome() {
  const [rides, setRides] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api
      .history()
      .then(({ rides }) => setRides(rides))
      .catch((err) => setError(err.message));
  }, []);
  usePolling(load, 10000);

  if (!rides) return <Spinner fullScreen />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Recent rides</h1>
      <ErrorBanner message={error} />
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3">Passenger</th>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Fare</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rides.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">{r.passenger?.name ?? '—'}</td>
                <td className="px-4 py-3">{r.driver?.name ?? '—'}</td>
                <td className="max-w-xs truncate px-4 py-3 text-gray-500">
                  {r.pickupLocation.address} → {r.dropoffLocation.address}
                </td>
                <td className="px-4 py-3 font-medium">{formatMoney(r.fare, r.currency)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
            {rides.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No rides yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
