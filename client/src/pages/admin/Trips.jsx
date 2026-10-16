import { useCallback, useEffect, useState } from 'react';
import { Route, ShieldAlert } from 'lucide-react';
import { useOnReconnect, useSocketEvent } from '../../context/SocketContext.jsx';
import { api, formatMoney, timeAgo } from '../../lib/api.js';
import { PageHeader } from '../../components/admin/AdminLayout.jsx';
import { OverrideDialog } from '../../components/admin/RideDialogs.jsx';
import { Badge, EmptyState, Panel, Tabs, btn } from '../../components/admin/ui.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Spinner from '../../components/Spinner.jsx';

const ACTIVE = ['requested', 'accepted', 'ongoing'];

export default function Trips() {
  const [rides, setRides] = useState(null);
  const [filter, setFilter] = useState('all');
  const [overriding, setOverriding] = useState(null);
  const [, tick] = useState(0);

  const load = useCallback(() => api.admin.activeTrips().then(({ rides }) => setRides(rides)).catch(() => setRides([])), []);
  useEffect(() => {
    load();
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [load]);
  useOnReconnect(load);

  // Merge live updates in place; finished rides drop off the board.
  useSocketEvent('ride:updated', ({ ride }) =>
    setRides((list) => {
      if (!list) return list;
      const rest = list.filter((r) => r.id !== ride.id);
      return ACTIVE.includes(ride.status) ? [ride, ...rest].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : rest;
    }),
  );

  if (!rides) return <Spinner fullScreen />;
  const count = (s) => rides.filter((r) => r.status === s).length;
  const shown = filter === 'all' ? rides : rides.filter((r) => r.status === filter);

  return (
    <>
      <PageHeader title="Active trips" description="Every ride that hasn't finished yet. Updates live." />
      <div className="mb-4">
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'all', label: 'All', count: rides.length },
            { value: 'requested', label: 'Waiting for driver', count: count('requested') },
            { value: 'accepted', label: 'Driver en route', count: count('accepted') },
            { value: 'ongoing', label: 'On trip', count: count('ongoing') },
          ]}
        />
      </div>
      <Panel>
        {shown.length === 0 ? (
          <EmptyState icon={Route} title="Nothing here right now">New ride requests appear instantly.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-3 py-3">Passenger</th>
                  <th className="px-3 py-3">Driver</th>
                  <th className="px-3 py-3">Route</th>
                  <th className="px-3 py-3 text-right">Fare</th>
                  <th className="px-3 py-3">Requested</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {shown.map((r) => {
                  const waitMin = (Date.now() - new Date(r.createdAt)) / 60000;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50/60">
                      <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-3">
                        <p className="font-medium">{r.passenger?.name}</p>
                        <p className="text-xs text-gray-500">{r.passenger?.phone ?? r.passenger?.email}</p>
                      </td>
                      <td className="px-3 py-3">
                        {r.driver ? (
                          <>
                            <p className="font-medium">{r.driver.name}</p>
                            <p className="text-xs text-gray-500">{r.driver.vehicle?.plate ?? r.driver.phone}</p>
                          </>
                        ) : (
                          <Badge tone="amber">Unassigned</Badge>
                        )}
                      </td>
                      <td className="max-w-72 px-3 py-3">
                        <p className="truncate">{r.pickupLocation.address}</p>
                        <p className="truncate text-gray-500">→ {r.dropoffLocation.address}</p>
                      </td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{formatMoney(r.fare, r.currency)}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className={r.status === 'requested' && waitMin > 5 ? 'font-medium text-amber-700' : 'text-gray-600'}>{timeAgo(r.createdAt)}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button className={btn.secondary} onClick={() => setOverriding(r)}>
                          <ShieldAlert className="h-4 w-4" /> Override
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {overriding && (
        <OverrideDialog
          ride={overriding}
          open
          onClose={() => setOverriding(null)}
          onDone={(ride) => setRides((list) => (ACTIVE.includes(ride.status) ? list.map((r) => (r.id === ride.id ? ride : r)) : list.filter((r) => r.id !== ride.id)))}
        />
      )}
    </>
  );
}
