import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CircleDollarSign, Flag, Gavel, Scale, ShieldAlert, XCircle } from 'lucide-react';
import { useSocketEvent } from '../../context/SocketContext.jsx';
import { api, formatDateTime, formatMoney, timeAgo } from '../../lib/api.js';
import { PageHeader } from '../../components/admin/AdminLayout.jsx';
import { OverrideDialog, RefundDialog, ResolveDialog } from '../../components/admin/RideDialogs.jsx';
import { Badge, EmptyState, Pagination, Panel, Tabs, btn } from '../../components/admin/ui.jsx';
import RouteSummary from '../../components/RouteSummary.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Spinner from '../../components/Spinner.jsx';

const REASONS = {
  overcharged: 'Overcharged',
  driver_behavior: 'Driver behaviour',
  passenger_behavior: 'Passenger behaviour',
  safety: 'Safety concern',
  route: 'Wrong or long route',
  no_show: 'No-show',
  other: 'Other',
};

function DisputeBadge({ ride }) {
  if (ride.dispute.status === 'open') return <Badge tone="red" icon={Flag}>Open report</Badge>;
  if (ride.dispute.status === 'resolved') return <Badge tone="green" icon={Gavel}>Resolved</Badge>;
  return <Badge tone="gray" icon={XCircle}>Cancelled by {ride.cancelledBy ?? '—'}</Badge>;
}

function describeEvent(e, currency) {
  switch (e.type) {
    case 'status':
      return e.from ? `${e.from} → ${e.to}` : `Ride ${e.to}`;
    case 'report':
      return `Reported: ${e.note}`;
    case 'refund':
      return `Refunded ${formatMoney(e.amount, currency)}${e.note ? ` · ${e.note}` : ''}`;
    case 'override':
      return `Status override ${e.from} → ${e.to}${e.note ? ` · ${e.note}` : ''}`;
    case 'resolve':
      return `Resolved · ${e.note}`;
    default:
      return e.type;
  }
}

function Timeline({ ride }) {
  return (
    <ol className="relative space-y-3 border-l border-gray-200 pl-5">
      {[...ride.events].reverse().map((e, i) => (
        <li key={i} className="relative text-sm">
          <span
            className={`absolute top-1.5 -left-[1.6rem] h-2.5 w-2.5 rounded-full ring-4 ring-white ${
              e.type === 'refund' ? 'bg-emerald-500' : e.type === 'override' ? 'bg-red-500' : e.type === 'report' ? 'bg-amber-500' : e.type === 'resolve' ? 'bg-gray-900' : 'bg-gray-300'
            }`}
          />
          <p className="text-gray-800">{describeEvent(e, ride.currency)}</p>
          <p className="text-xs text-gray-500">
            {e.byRole ?? 'system'} · {formatDateTime(e.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Detail({ ride, onChange }) {
  const [dialog, setDialog] = useState(null);
  const remaining = Math.round((ride.fare - ride.refundedAmount) * 100) / 100;
  const canRefund = ride.status === 'completed' && remaining > 0;

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-gray-400">Ride {ride.id.slice(-8)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={ride.status} />
            <DisputeBadge ride={ride} />
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold tabular-nums">{formatMoney(ride.fare, ride.currency)}</p>
          {ride.refundedAmount > 0 && (
            <p className="text-xs text-emerald-700">−{formatMoney(ride.refundedAmount, ride.currency)} refunded</p>
          )}
        </div>
      </div>

      {ride.report && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-sm font-semibold text-amber-900">
            {REASONS[ride.report.reason] ?? ride.report.reason}
            <span className="font-normal text-amber-800"> · reported by {ride.report.byRole} {timeAgo(ride.report.createdAt)}</span>
          </p>
          {ride.report.details && <p className="mt-1 text-sm text-gray-800">“{ride.report.details}”</p>}
        </div>
      )}
      {ride.dispute.status === 'resolved' && (
        <div className="rounded-xl bg-gray-50 p-4 text-sm">
          <p className="font-semibold">Resolution</p>
          <p className="text-gray-700">{ride.dispute.resolution}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {ride.dispute.status === 'open' && (
          <button className={btn.primary} onClick={() => setDialog('resolve')}>
            <Gavel className="h-4 w-4" /> Resolve
          </button>
        )}
        <button className={btn.secondary} disabled={!canRefund} onClick={() => setDialog('refund')} title={canRefund ? '' : 'Only completed rides with an unrefunded balance can be refunded'}>
          <CircleDollarSign className="h-4 w-4" /> Refund
        </button>
        <button className={btn.secondary} onClick={() => setDialog('override')}>
          <ShieldAlert className="h-4 w-4" /> Override status
        </button>
      </div>

      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        {[
          ['Passenger', ride.passenger],
          ['Driver', ride.driver],
        ].map(([label, p]) => (
          <div key={label} className="rounded-xl border border-gray-100 p-3">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="font-medium">{p?.name ?? 'None'}</dd>
            {p && <dd className="text-xs text-gray-500">{[p.phone, p.email].filter(Boolean).join(' · ')}</dd>}
            {p?.status === 'banned' && <dd className="mt-1"><Badge tone="red">Suspended</Badge></dd>}
          </div>
        ))}
      </dl>

      <div className="rounded-xl border border-gray-100 p-4">
        <RouteSummary pickup={ride.pickupLocation.address} dropoff={ride.dropoffLocation.address} />
        <p className="mt-3 text-xs text-gray-500">
          {ride.distanceKm?.toFixed(1)} km · ~{ride.durationMin} min{ride.surgeMultiplier > 1 && ` · ${ride.surgeMultiplier}× surge`} · requested {formatDateTime(ride.createdAt)}
        </p>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">Timeline</h3>
        <Timeline ride={ride} />
      </div>

      <RefundDialog ride={ride} open={dialog === 'refund'} onClose={() => setDialog(null)} onDone={onChange} />
      <OverrideDialog ride={ride} open={dialog === 'override'} onClose={() => setDialog(null)} onDone={onChange} />
      <ResolveDialog ride={ride} open={dialog === 'resolve'} onClose={() => setDialog(null)} onDone={onChange} />
    </div>
  );
}

export default function Disputes() {
  const { stats } = useOutletContext();
  const [view, setView] = useState('open');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.admin
      .rides({ view, page })
      .then((d) => {
        setData(d);
        setError(null);
        setSelectedId((cur) => (d.rides.some((r) => r.id === cur) ? cur : d.rides[0]?.id ?? null));
      })
      .catch((err) => setError(err.message));
  }, [view, page]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (stats) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.disputes.open]);

  const replace = (ride) => setData((d) => d && { ...d, rides: d.rides.map((r) => (r.id === ride.id ? ride : r)) });
  useSocketEvent('ride:updated', ({ ride }) => replace(ride));

  const selected = data?.rides.find((r) => r.id === selectedId);
  const c = data?.counts;

  return (
    <>
      <PageHeader title="Disputes" description="Reported and cancelled rides. Issue refunds, override statuses and close reports." />
      <div className="mb-4">
        <Tabs
          value={view}
          onChange={(v) => {
            setView(v);
            setPage(1);
          }}
          tabs={[
            { value: 'open', label: 'Open reports', count: c?.open },
            { value: 'reported', label: 'All reports', count: c?.reported },
            { value: 'cancelled', label: 'Cancelled', count: c?.cancelled },
            { value: 'resolved', label: 'Resolved', count: c?.resolved },
            { value: 'all', label: 'Everything', count: c?.all },
          ]}
        />
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Panel className="lg:self-start" bodyClass="flex flex-col">
          {!data ? (
            <div className="flex justify-center p-10"><Spinner /></div>
          ) : data.rides.length === 0 ? (
            <EmptyState icon={Scale} title={view === 'open' ? 'No open reports' : 'Nothing here'}>
              {view === 'open' && 'Reports from passengers and drivers show up here.'}
            </EmptyState>
          ) : (
            <>
              <ul className="divide-y divide-gray-100">
                {data.rides.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full px-4 py-3 text-left transition ${r.id === selectedId ? 'bg-gray-50 ring-1 ring-gray-200 ring-inset' : 'hover:bg-gray-50'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{r.passenger?.name ?? 'Unknown'}</span>
                        <span className="shrink-0 text-xs text-gray-500">{timeAgo(r.report?.createdAt ?? r.cancelledAt ?? r.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        {r.pickupLocation.address} → {r.dropoffLocation.address}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <DisputeBadge ride={r} />
                        {r.report && <Badge tone="gray">{REASONS[r.report.reason]}</Badge>}
                        {r.refundedAmount > 0 && <Badge tone="green">Refunded</Badge>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
            </>
          )}
        </Panel>

        <Panel className="min-h-80">
          {selected ? (
            <Detail key={selected.id} ride={selected} onChange={replace} />
          ) : (
            <EmptyState icon={Scale} title="Select a ride">Pick a ride on the left to see its details and timeline.</EmptyState>
          )}
        </Panel>
      </div>
    </>
  );
}
