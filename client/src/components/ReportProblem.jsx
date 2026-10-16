import { useEffect, useState } from 'react';
import { CheckCircle2, Flag } from 'lucide-react';
import { api } from '../lib/api.js';

/** "Report a problem" for a finished ride. Reports land in the admin Disputes queue. */
export default function ReportProblem({ ride, onReported, exclude = [] }) {
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState(null);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && !reasons) api.reportReasons().then(({ reasons }) => setReasons(reasons)).catch(() => {});
  }, [open, reasons]);

  if (ride.report) {
    return (
      <div className="card flex items-start gap-3 text-sm">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <div>
          <p className="font-semibold">
            {ride.dispute.status === 'resolved' ? 'Your report was resolved' : 'Problem reported'}
          </p>
          <p className="text-gray-500">
            {ride.dispute.status === 'resolved'
              ? ride.dispute.resolution
              : 'Our team will review it and get back to you.'}
          </p>
          {ride.refundedAmount > 0 && (
            <p className="mt-1 font-medium text-brand-700">
              Refunded {new Intl.NumberFormat(undefined, { style: 'currency', currency: ride.currency }).format(ride.refundedAmount)}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary w-full text-sm">
        <Flag className="h-4 w-4" /> Report a problem
      </button>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ride: updated } = await api.reportRide(ride.id, reason, details);
      onReported(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3">
      <p className="font-semibold">What went wrong?</p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(reasons ?? {})
          .filter(([key]) => !exclude.includes(key))
          .map(([key, label]) => (
            <button
              type="button"
              key={key}
              onClick={() => setReason(key)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                reason === key ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
      </div>
      <textarea
        id="report-details"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="Tell us what happened (optional)"
        className="w-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm outline-none focus:border-brand-500 focus:bg-white"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-sm">
          Cancel
        </button>
        <button disabled={!reason || busy} className="btn-primary text-sm">
          Send report
        </button>
      </div>
    </form>
  );
}
