import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Bike, CircleDollarSign, Clock, FileCheck2, Route, Scale, Users } from 'lucide-react';
import { useSocketEvent } from '../../context/SocketContext.jsx';
import { api, formatMoney, formatNumber, timeAgo } from '../../lib/api.js';
import { PageHeader } from '../../components/admin/AdminLayout.jsx';
import { Badge, EmptyState, Panel, StatTile } from '../../components/admin/ui.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Spinner from '../../components/Spinner.jsx';

const STATUS_ORDER = ['requested', 'accepted', 'ongoing', 'completed', 'cancelled'];

function StatusBreakdown({ counts, total }) {
  return (
    <ul className="space-y-3">
      {STATUS_ORDER.map((s) => {
        const n = counts[s] ?? 0;
        const pct = total ? Math.round((n / total) * 100) : 0;
        return (
          <li key={s} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-3 text-sm">
            <StatusBadge status={s} />
            <div className="h-2 rounded-full bg-gray-100" aria-hidden="true">
              <div className="h-2 rounded-full bg-gray-800" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-right text-gray-700 tabular-nums">
              {n} <span className="text-gray-400">· {pct}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function AttentionItem({ to, icon: Icon, count, label, tone }) {
  const text = count === 1 ? label[0] : label[1];
  return (
    <Link to={to} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-gray-50">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${count ? (tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700') : 'bg-gray-50 text-gray-400'}`}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <span className="flex-1 text-sm">
        <span className="font-semibold tabular-nums">{count}</span> <span className="text-gray-600">{text}</span>
      </span>
      <ArrowRight className="h-4 w-4 text-gray-300" />
    </Link>
  );
}

export default function Overview() {
  const { stats } = useOutletContext();
  const [trips, setTrips] = useState(null);

  const loadTrips = useCallback(() => api.admin.activeTrips().then(({ rides }) => setTrips(rides)).catch(() => {}), []);
  useEffect(() => {
    loadTrips();
  }, [loadTrips]);
  useSocketEvent('ride:updated', loadTrips);

  if (!stats) return <Spinner fullScreen />;
  const { rides, revenue, users, drivers, disputes, currency } = stats;
  const money = (n) => formatMoney(n, currency);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Today, ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · updates live`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Rides today" icon={Route} value={formatNumber(rides.today)} delta={{ current: rides.today, previous: rides.yesterday }} />
        <StatTile
          label="Drivers online"
          icon={Bike}
          value={formatNumber(drivers.online)}
          hint={`${rides.activeTrips} on a trip · ${rides.waitingRequests} request${rides.waitingRequests === 1 ? '' : 's'} waiting`}
          to="/admin/fleet"
        />
        <StatTile
          label="Revenue today"
          icon={CircleDollarSign}
          value={money(revenue.today.net)}
          delta={{ current: revenue.today.net, previous: revenue.yesterday.net, format: money }}
        />
        <StatTile
          label="Registered users"
          icon={Users}
          value={formatNumber(users.total)}
          hint={`${users.byRole.passenger} passengers · ${users.byRole.driver} drivers${users.newToday ? ` · ${users.newToday} new today` : ''}`}
          to="/admin/users"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Rides today by status" bodyClass="p-5">
          {rides.today ? <StatusBreakdown counts={rides.todayByStatus} total={rides.today} /> : <p className="text-sm text-gray-500">No rides yet today.</p>}
        </Panel>

        <Panel title="Needs attention" bodyClass="p-2">
          <AttentionItem to="/admin/users?verification=pending" icon={FileCheck2} count={drivers.pendingVerifications} label={['driver awaiting document review', 'drivers awaiting document review']} />
          <AttentionItem to="/admin/disputes" icon={Scale} count={disputes.open} label={['open dispute', 'open disputes']} tone="red" />
          <AttentionItem to="/admin/trips" icon={Clock} count={rides.waitingRequests} label={['ride request without a driver', 'ride requests without a driver']} />
          <AttentionItem to="/admin/users?status=banned" icon={AlertTriangle} count={users.banned} label={['suspended account', 'suspended accounts']} />
        </Panel>

        <Panel title="Revenue" bodyClass="p-5">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500">Net, all time</dt><dd className="text-lg font-semibold">{money(revenue.allTime.net)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Gross fares</dt><dd className="tabular-nums">{money(revenue.allTime.gross)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Refunds issued</dt><dd className="text-red-600 tabular-nums">−{money(revenue.allTime.refunds)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Completed trips</dt><dd className="tabular-nums">{formatNumber(revenue.allTime.trips)}</dd></div>
            <div className="flex justify-between border-t border-gray-100 pt-3"><dt className="text-gray-500">Today gross / refunds</dt><dd className="tabular-nums">{money(revenue.today.gross)} / {money(revenue.today.refunds)}</dd></div>
          </dl>
        </Panel>
      </div>

      <Panel
        className="mt-4"
        title="Live trips"
        action={<Link to="/admin/trips" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>}
      >
        {!trips ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : trips.length === 0 ? (
          <EmptyState icon={Route} title="No trips in progress" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {trips.slice(0, 6).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <StatusBadge status={r.status} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{r.passenger?.name}</span>
                  <span className="text-gray-400"> · </span>
                  <span className="text-gray-600">{r.pickupLocation.address} → {r.dropoffLocation.address}</span>
                </span>
                {r.driver ? <span className="text-gray-600">{r.driver.name}</span> : <Badge tone="amber">No driver yet</Badge>}
                <span className="w-20 text-right font-medium tabular-nums">{formatMoney(r.fare, r.currency)}</span>
                <span className="w-16 text-right text-xs text-gray-400">{timeAgo(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
