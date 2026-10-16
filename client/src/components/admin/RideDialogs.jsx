import { useEffect, useState } from 'react';
import { api, formatMoney } from '../../lib/api.js';
import { Dialog, Field, btn, inputCls } from './ui.jsx';

function useAction(onDone, onClose) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      const { ride } = await fn();
      onDone(ride);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function RefundDialog({ ride, open, onClose, onDone }) {
  const remaining = Math.round((ride.fare - (ride.refundedAmount ?? 0)) * 100) / 100;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, run, setError } = useAction(onDone, onClose);
  useEffect(() => {
    if (open) {
      setAmount(remaining.toFixed(2));
      setReason('');
      setError(null);
    }
  }, [open, remaining, setError]);

  const value = Number(amount);
  const valid = value > 0 && value <= remaining + 1e-9 && reason.trim();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Issue refund"
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>Cancel</button>
          <button className={btn.primary} disabled={!valid || busy} onClick={() => run(() => api.admin.refund(ride.id, value, reason))}>
            Refund {value > 0 ? formatMoney(value, ride.currency) : ''}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-600">
        Fare {formatMoney(ride.fare, ride.currency)} · already refunded {formatMoney(ride.refundedAmount, ride.currency)} ·{' '}
        <span className="font-medium text-gray-900">up to {formatMoney(remaining, ride.currency)} available</span>
      </p>
      <Field label={`Amount (${ride.currency})`} htmlFor="refund-amount">
        <div className="flex gap-2">
          <input id="refund-amount" type="number" min="0.01" step="0.01" max={remaining} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          {[0.25, 0.5, 1].map((f) => (
            <button key={f} type="button" className={btn.secondary} onClick={() => setAmount((Math.floor(remaining * f * 100) / 100).toFixed(2))}>
              {f === 1 ? 'Full' : `${f * 100}%`}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Reason" htmlFor="refund-reason" hint="Saved to the ride's audit trail.">
        <textarea id="refund-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="e.g. Detour confirmed on GPS trace" />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}

export function OverrideDialog({ ride, open, onClose, onDone }) {
  const options = [
    { value: 'completed', label: 'Mark completed', help: 'The trip happened. Counts toward revenue and frees the driver.', disabled: !ride.driver },
    { value: 'cancelled', label: 'Cancel ride', help: 'The trip did not happen. Frees the driver and removes it from revenue.', disabled: ride.refundedAmount > 0 },
  ].filter((o) => o.value !== ride.status);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, run, setError } = useAction(onDone, onClose);
  useEffect(() => {
    if (open) {
      setStatus(options.find((o) => !o.disabled)?.value ?? '');
      setReason('');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Override ride status"
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>Cancel</button>
          <button className={btn.danger} disabled={!status || !reason.trim() || busy} onClick={() => run(() => api.admin.override(ride.id, status, reason))}>
            Override to {status || '…'}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-600">
        Currently <span className="font-medium text-gray-900">{ride.status}</span>. Overrides skip the normal ride flow and are logged with your name.
      </p>
      <fieldset className="space-y-2">
        {options.map((o) => (
          <label key={o.value} className={`flex gap-3 rounded-xl border p-3 ${status === o.value ? 'border-gray-900' : 'border-gray-200'} ${o.disabled ? 'opacity-50' : 'cursor-pointer'}`}>
            <input type="radio" name="override" value={o.value} checked={status === o.value} disabled={o.disabled} onChange={() => setStatus(o.value)} className="mt-1" />
            <span>
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block text-xs text-gray-500">
                {o.disabled ? (o.value === 'completed' ? 'No driver ever accepted this ride.' : 'Refunds were issued; refund the remainder instead.') : o.help}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="Reason" htmlFor="override-reason">
        <textarea id="override-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="e.g. Driver's app crashed mid-trip" />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}

export function ResolveDialog({ ride, open, onClose, onDone }) {
  const [resolution, setResolution] = useState('');
  const { busy, error, run, setError } = useAction(onDone, onClose);
  useEffect(() => {
    if (open) {
      setResolution('');
      setError(null);
    }
  }, [open, setError]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Resolve dispute"
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>Cancel</button>
          <button className={btn.success} disabled={!resolution.trim() || busy} onClick={() => run(() => api.admin.resolve(ride.id, resolution))}>
            Mark resolved
          </button>
        </>
      }
    >
      <Field label="Resolution" htmlFor="resolution" hint="The passenger sees this message on their ride.">
        <textarea id="resolution" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} className={inputCls} placeholder="e.g. We refunded 30% for the detour. Sorry about that." />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}
