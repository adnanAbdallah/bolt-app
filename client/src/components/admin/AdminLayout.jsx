import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bike, Gauge, LogOut, Map, Menu, Route, Scale, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useOnReconnect, useSocket, useSocketEvent } from '../../context/SocketContext.jsx';
import { api } from '../../lib/api.js';
import Avatar from '../Avatar.jsx';

const NAV = [
  { to: '/admin', end: true, label: 'Overview', icon: Gauge },
  { to: '/admin/fleet', label: 'Live fleet', icon: Map, count: (s) => s?.drivers.online, tone: 'live' },
  { to: '/admin/users', label: 'Users & drivers', icon: Users, count: (s) => s?.drivers.pendingVerifications, tone: 'attention' },
  { to: '/admin/trips', label: 'Active trips', icon: Route, count: (s) => s && s.rides.activeTrips + s.rides.waitingRequests, tone: 'live' },
  { to: '/admin/disputes', label: 'Disputes', icon: Scale, count: (s) => s?.disputes.open, tone: 'attention' },
];

function Sidebar({ stats, onNavigate }) {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col bg-gray-950 text-gray-300">
      <div className="flex h-16 items-center gap-2 px-5 font-semibold text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
          <Bike className="h-4.5 w-4.5" />
        </span>
        Bolt Moto
        <span className="ml-auto rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-gray-300">Admin</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2" aria-label="Admin">
        {NAV.map(({ to, end, label, icon: Icon, count, tone }) => {
          const n = count?.(stats);
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <Icon className="h-4.5 w-4.5" />
              {label}
              {n > 0 && (
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-xs tabular-nums ${
                    tone === 'attention' ? 'bg-amber-400/15 text-amber-300' : 'bg-white/10 text-gray-300'
                  }`}
                >
                  {n}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2 px-2 pb-3 text-xs">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-brand-500' : 'bg-gray-500'}`} />
          {connected ? 'Live updates on' : 'Reconnecting…'}
        </div>
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar user={user} size="h-8 w-8" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user?.name}</p>
            <p className="truncate text-xs text-gray-400">{user?.email}</p>
          </div>
          <button
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Admin shell: sidebar + live stats shared with every admin page via outlet context. */
export default function AdminLayout() {
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const timer = useRef(null);

  const reloadStats = useCallback(() => {
    api.admin
      .stats()
      .then((s) => {
        setStats(s);
        setStatsError(null);
      })
      .catch((err) => setStatsError(err.message));
  }, []);

  useEffect(() => {
    reloadStats();
    const id = setInterval(reloadStats, 60_000); // keeps "today" correct across midnight
    return () => clearInterval(id);
  }, [reloadStats]);
  useOnReconnect(reloadStats);

  // Many events can fire in a burst (e.g. demo fleet); coalesce into one refetch.
  useSocketEvent('stats:changed', () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(reloadStats, 700);
  });

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar stats={stats} />
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 lg:hidden">
        <button onClick={() => setMenuOpen(true)} className="rounded-lg p-1.5 hover:bg-gray-100" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-semibold">Bolt Moto Admin</span>
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-gray-950/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <Sidebar stats={stats} onNavigate={() => setMenuOpen(false)} />
            <button
              onClick={() => setMenuOpen(false)}
              className="absolute top-4 right-3 rounded-lg p-1 text-gray-400 hover:text-white"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {statsError && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">Couldn't load stats: {statsError}</p>
          )}
          <Outlet context={{ stats, reloadStats }} />
        </div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
