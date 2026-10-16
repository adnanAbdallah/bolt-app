import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Minus, X } from 'lucide-react';

/** KPI tile: sentence-case label, value, optional delta vs a named period. */
export function StatTile({ label, value, icon: Icon, delta, hint, to }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-500">{label}</p>
        {Icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-50 text-gray-500">
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">{value}</p>
      <div className="mt-1 min-h-5 text-xs">
        {delta ? <Delta {...delta} /> : hint ? <span className="text-gray-500">{hint}</span> : null}
      </div>
    </>
  );
  const cls = 'block rounded-2xl border border-gray-200/70 bg-white p-5';
  return to ? (
    <Link to={to} className={`${cls} transition hover:border-gray-300`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Signed change vs. a named period. Up is good for every metric we show. */
function Delta({ current, previous, label = 'vs yesterday', format = (n) => n }) {
  const diff = current - previous;
  if (previous === 0 && current === 0) return <span className="text-gray-500">No activity {label.replace('vs ', '')}</span>;
  const pct = previous === 0 ? null : Math.round((diff / previous) * 100);
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  const color = diff > 0 ? 'text-emerald-700' : diff < 0 ? 'text-red-600' : 'text-gray-500';
  return (
    <span className={`inline-flex items-center gap-1 ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {diff > 0 ? '+' : diff < 0 ? '−' : ''}
      {format(Math.abs(diff))}
      {pct !== null && ` (${pct > 0 ? '+' : ''}${pct}%)`}
      <span className="text-gray-500">{label}</span>
    </span>
  );
}

export function Panel({ title, action, children, className = '', bodyClass = '' }) {
  return (
    <section className={`rounded-2xl border border-gray-200/70 bg-white ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3.5">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

const TONES = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/15',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/15',
  gray: 'bg-gray-50 text-gray-600 ring-gray-500/15',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/15',
};

export function Badge({ tone = 'gray', icon: Icon, children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONES[tone]}`}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            value === t.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={`rounded-full px-1.5 text-xs tabular-nums ${value === t.value ? 'bg-gray-100' : 'bg-gray-200/70'}`}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }) {
  if (pages <= 1) return <p className="px-5 py-3 text-xs text-gray-500">{total} total</p>;
  return (
    <div className="flex items-center justify-between px-5 py-3 text-sm">
      <span className="text-gray-500">
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-1">
        <button className="rounded-lg border border-gray-200 p-1.5 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button className="rounded-lg border border-gray-200 p-1.5 disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {Icon && <Icon className="h-8 w-8 text-gray-300" />}
      <p className="font-medium text-gray-700">{title}</p>
      {children && <p className="max-w-sm text-sm text-gray-500">{children}</p>}
    </div>
  );
}

/** Accessible modal dialog built on <dialog>. */
export function Dialog({ open, title, onClose, children, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl p-0 shadow-2xl backdrop:bg-gray-950/40"
    >
      {open && (
        <div className="flex flex-col">
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h2 className="font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="space-y-4 px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, htmlFor, children, hint }) {
  return (
    <label htmlFor={htmlFor} className="block space-y-1.5">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

export const btn = {
  primary: 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50',
  secondary: 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50',
  danger: 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50',
  success: 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50',
  ghost: 'inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50',
};
