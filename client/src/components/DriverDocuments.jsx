import { useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, Clock3, FileText, Upload } from 'lucide-react';
import { api } from '../lib/api.js';

const LABELS = { license: "Driver's license", insurance: 'Motorcycle insurance' };
const STATUS = {
  missing: { text: 'Not uploaded', cls: 'bg-gray-100 text-gray-600', Icon: FileText },
  pending: { text: 'In review', cls: 'bg-amber-50 text-amber-700', Icon: Clock3 },
  approved: { text: 'Approved', cls: 'bg-brand-50 text-brand-700', Icon: BadgeCheck },
  rejected: { text: 'Rejected', cls: 'bg-red-50 text-red-600', Icon: AlertTriangle },
};

function DocumentRow({ type, doc, onUploaded }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { text, cls, Icon } = STATUS[doc.status] ?? STATUS.missing;
  const canUpload = doc.status === 'missing' || doc.status === 'rejected';

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setError('Files must be 10 MB or smaller');
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.uploadDocument(type, file);
      onUploaded(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-[12rem] flex-1">
        <p className="font-medium">{LABELS[type]}</p>
        <p className="truncate text-xs text-gray-500">{doc.fileName ?? 'Photo or PDF, up to 10 MB'}</p>
        {doc.status === 'rejected' && doc.note && <p className="mt-1 text-xs text-red-600">{doc.note}</p>}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
        <Icon className="h-3.5 w-3.5" /> {text}
      </span>
      {canUpload && (
        <>
          <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} />
          <button onClick={() => input.current?.click()} disabled={busy} className="btn-secondary px-3 py-2 text-sm">
            <Upload className="h-4 w-4" /> {doc.status === 'rejected' ? 'Re-upload' : 'Upload'}
          </button>
        </>
      )}
    </li>
  );
}

/** Verification checklist shown until both documents are approved. */
export default function DriverDocuments({ user, onUpdated }) {
  const docs = user.documents ?? {};
  const pending = Object.values(docs).some((d) => d.status === 'pending');
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-bold">Get verified to start driving</h2>
        <p className="text-sm text-gray-500">
          {pending
            ? 'Thanks! An admin is reviewing your documents. You can go online once both are approved.'
            : 'Upload both documents. An admin reviews them, usually within a day.'}
        </p>
      </div>
      <ul className="divide-y divide-gray-100">
        {['license', 'insurance'].map((t) => (
          <DocumentRow key={t} type={t} doc={docs[t] ?? { status: 'missing' }} onUploaded={onUpdated} />
        ))}
      </ul>
      <p className="text-xs text-gray-400">Demo upload: only the file name and size are sent, not the file.</p>
    </section>
  );
}
