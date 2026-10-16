import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, WifiOff } from 'lucide-react';
import { useOnReconnect, useSocketEvent } from '../../context/SocketContext.jsx';
import { api, timeAgo } from '../../lib/api.js';
import { PageHeader } from '../../components/admin/AdminLayout.jsx';
import FleetMap, { STATE_STYLE, StateGlyph, driverState } from '../../components/admin/FleetMap.jsx';
import { EmptyState, inputCls } from '../../components/admin/ui.jsx';
import Avatar from '../../components/Avatar.jsx';

const ORDER = ['available', 'pickup', 'trip', 'stale'];

export default function Fleet() {
  const [drivers, setDrivers] = useState(new Map());
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [q, setQ] = useState('');
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const { drivers: list } = await api.admin.fleet();
    setDrivers(new Map(list.map((d) => [d.id, d])));
    setLoaded(true);
  }, []);
  useEffect(() => {
    load().catch(() => setLoaded(true));
  }, [load]);
  useOnReconnect(load);

  useSocketEvent('fleet:update', ({ driver }) => setDrivers((m) => new Map(m).set(driver.id, driver)));
  useSocketEvent('fleet:remove', ({ driverId }) =>
    setDrivers((m) => {
      const next = new Map(m);
      next.delete(driverId);
      return next;
    }),
  );

  // Re-render every 10s so "updated Xs ago" and stale markers stay honest.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const list = useMemo(() => [...drivers.values()], [drivers]);
  const counts = useMemo(() => Object.fromEntries(ORDER.map((s) => [s, list.filter((d) => driverState(d) === s).length])), [list]);
  const shown = list
    .filter((d) => !q || `${d.name} ${d.vehicle?.plate ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => ORDER.indexOf(driverState(a)) - ORDER.indexOf(driverState(b)) || a.name.localeCompare(b.name));
  const onSelect = useCallback((id) => setSelectedId((cur) => (cur === id ? null : id)), []);

  return (
    <>
      <PageHeader title="Live fleet" description={`${list.length} driver${list.length === 1 ? '' : 's'} online · positions update in real time`} />

      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Map legend">
        {ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ background: STATE_STYLE[s].color }}>
              <StateGlyph state={s} className="h-3 w-3" />
            </span>
            {STATE_STYLE[s].label} <span className="text-gray-500 tabular-nums">{counts[s]}</span>
          </span>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="overflow-hidden rounded-2xl border border-gray-200/70 bg-white">
          <FleetMap drivers={list} selectedId={selectedId} onSelect={onSelect} className="h-[60vh] min-h-[22rem] w-full lg:h-[calc(100vh-13rem)]" />
        </div>

        <aside className="flex max-h-[calc(100vh-13rem)] min-h-0 flex-col rounded-2xl border border-gray-200/70 bg-white">
          <div className="border-b border-gray-100 p-3">
            <label className="relative block">
              <span className="sr-only">Search drivers</span>
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input id="fleet-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or plate" className={`${inputCls} pl-9`} />
            </label>
          </div>
          {!loaded ? null : shown.length === 0 ? (
            <EmptyState icon={WifiOff} title={list.length ? 'No matches' : 'No drivers online'}>
              {!list.length && 'Drivers appear here as soon as they go online. Run "npm run seed" in server/ for demo drivers.'}
            </EmptyState>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto">
              {shown.map((d) => {
                const s = driverState(d);
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => onSelect(d.id)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${selectedId === d.id ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                    >
                      <Avatar user={d} size="h-9 w-9" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{d.name}</span>
                          {d.isDemo && <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500">demo</span>}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {d.vehicle?.plate ?? 'No plate'} · {d.location ? `${d.location.simulated ? 'sim · ' : ''}${timeAgo(d.location.updatedAt)}` : 'waiting for GPS'}
                        </span>
                        <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-gray-600">
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white" style={{ background: STATE_STYLE[s].color }}>
                            <StateGlyph state={s} className="h-2.5 w-2.5" />
                          </span>
                          <span className="font-medium whitespace-nowrap">{STATE_STYLE[s].label}</span>
                          {d.trip && <span className="truncate text-gray-500">· {d.trip.pickup} → {d.trip.dropoff}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}
