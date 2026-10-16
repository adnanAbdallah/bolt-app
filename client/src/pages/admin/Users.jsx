import { useCallback, useEffect, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, Ban, Clock3, FileText, RotateCcw, Search, ShieldCheck, Users as UsersIcon } from 'lucide-react';
import { api, formatDateTime, timeAgo } from '../../lib/api.js';
import { PageHeader } from '../../components/admin/AdminLayout.jsx';
import { Badge, Dialog, EmptyState, Field, Pagination, Panel, Tabs, btn, inputCls } from '../../components/admin/ui.jsx';
import Avatar from '../../components/Avatar.jsx';
import Spinner from '../../components/Spinner.jsx';

const DOC_LABEL = { license: "Driver's license", insurance: 'Insurance' };
const DOC_TONE = {
  missing: { tone: 'gray', icon: FileText, text: 'Missing' },
  pending: { tone: 'amber', icon: Clock3, text: 'In review' },
  approved: { tone: 'green', icon: BadgeCheck, text: 'Approved' },
  rejected: { tone: 'red', icon: AlertTriangle, text: 'Rejected' },
};
const ROLE_TONE = { passenger: 'gray', driver: 'blue', admin: 'violet' };

function DocBadge({ type, doc }) {
  const d = DOC_TONE[doc?.status ?? 'missing'];
  return (
    <Badge tone={d.tone} icon={d.icon}>
      {type === 'license' ? 'License' : 'Insurance'}: {d.text}
    </Badge>
  );
}

function formatSize(bytes) {
  if (!bytes) return '';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function ReviewDialog({ user, onClose, onUpdated }) {
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  const review = async (type, status) => {
    setBusy(type);
    setError(null);
    try {
      const { user: updated } = await api.admin.reviewDocument(user.id, type, status, status === 'rejected' ? note : undefined);
      onUpdated(updated);
      setRejecting(null);
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={Boolean(user)} onClose={onClose} title={`Documents · ${user?.name ?? ''}`} footer={<button className={btn.secondary} onClick={onClose}>Done</button>}>
      {user && (
        <>
          <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-3 text-sm">
            <Avatar user={user} size="h-10 w-10" />
            <div className="min-w-0">
              <p className="font-medium">{user.name}</p>
              <p className="truncate text-gray-500">
                {user.vehicle?.plate ? `${user.vehicle.make ?? ''} ${user.vehicle.model ?? ''} · ${user.vehicle.plate}` : 'No vehicle on file'}
              </p>
            </div>
            {user.verified && <Badge tone="green" icon={ShieldCheck}>Verified</Badge>}
          </div>

          {['license', 'insurance'].map((type) => {
            const doc = user.documents?.[type] ?? { status: 'missing' };
            const reviewable = doc.status !== 'missing';
            return (
              <div key={type} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{DOC_LABEL[type]}</p>
                    <p className="text-sm text-gray-500">
                      {doc.fileName ? `${doc.fileName} · ${formatSize(doc.fileSize)} · uploaded ${timeAgo(doc.uploadedAt)}` : 'Not uploaded yet'}
                    </p>
                    {doc.note && <p className="mt-1 text-sm text-red-600">Note: {doc.note}</p>}
                  </div>
                  <DocBadge type={type} doc={doc} />
                </div>
                {reviewable && rejecting !== type && (
                  <div className="mt-3 flex gap-2">
                    {doc.status !== 'approved' && (
                      <button className={btn.success} disabled={busy === type} onClick={() => review(type, 'approved')}>
                        <BadgeCheck className="h-4 w-4" /> Approve
                      </button>
                    )}
                    {doc.status !== 'rejected' && (
                      <button className={btn.secondary} disabled={busy === type} onClick={() => setRejecting(type)}>
                        Reject…
                      </button>
                    )}
                  </div>
                )}
                {rejecting === type && (
                  <div className="mt-3 space-y-2">
                    <Field label="Tell the driver what to fix" htmlFor={`reject-${type}`}>
                      <input id={`reject-${type}`} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="e.g. Photo is blurry, please re-upload" />
                    </Field>
                    <div className="flex gap-2">
                      <button className={btn.danger} disabled={!note.trim() || busy === type} onClick={() => review(type, 'rejected')}>
                        Reject document
                      </button>
                      <button className={btn.ghost} onClick={() => setRejecting(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-xs text-gray-500">Mock uploads: only file names and sizes are stored. Drivers can go online once both documents are approved.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </>
      )}
    </Dialog>
  );
}

function BanDialog({ user, onClose, onUpdated }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    setReason('');
    setError(null);
  }, [user]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { user: updated } = await api.admin.setUserStatus(user.id, 'banned', reason);
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={Boolean(user)}
      onClose={onClose}
      title={`Suspend ${user?.name ?? ''}`}
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>Cancel</button>
          <button className={btn.danger} disabled={!reason.trim() || busy} onClick={submit}>
            <Ban className="h-4 w-4" /> Suspend account
          </button>
        </>
      }
    >
      <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
        <li>They are signed out on every device right away and can't sign in again.</li>
        {user?.role === 'driver' && <li>They are taken offline and removed from the fleet map.</li>}
        <li>Their rides that haven't started yet are cancelled. Trips already in progress are not touched.</li>
      </ul>
      <Field label="Reason" htmlFor="ban-reason" hint="Visible to other admins.">
        <textarea id="ban-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="e.g. Repeated no-shows" />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}

export default function Users() {
  const { stats } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const verification = params.get('verification') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const [banning, setBanning] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Debounce the search box into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) setParam({ q });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const load = useCallback(() => {
    api.admin
      .users({ role, status, verification, q: params.get('q'), page })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, [role, status, verification, params, page]);

  useEffect(() => {
    load();
  }, [load]);
  // Stats change when drivers upload documents or go online; keep the table in step.
  useEffect(() => {
    if (stats) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.generatedAt]);

  const replaceUser = (u) => {
    setData((d) => d && { ...d, users: d.users.map((x) => (x.id === u.id ? u : x)) });
    setReviewing((r) => (r?.id === u.id ? u : r));
  };

  const activate = async (u) => {
    setBusyId(u.id);
    try {
      replaceUser((await api.admin.setUserStatus(u.id, 'active')).user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const tab = verification === 'pending' ? 'pending' : role || 'all';

  return (
    <>
      <PageHeader title="Users & drivers" description="Review driver documents, and suspend or reactivate accounts." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          value={tab}
          onChange={(v) =>
            v === 'pending' ? setParam({ verification: 'pending', role: '' }) : setParam({ role: v === 'all' ? '' : v, verification: '' })
          }
          tabs={[
            { value: 'all', label: 'All', count: stats?.users.total },
            { value: 'passenger', label: 'Passengers', count: stats?.users.byRole.passenger },
            { value: 'driver', label: 'Drivers', count: stats?.users.byRole.driver },
            { value: 'admin', label: 'Admins', count: stats?.users.byRole.admin },
            { value: 'pending', label: 'Awaiting review', count: stats?.drivers.pendingVerifications },
          ]}
        />
        <select
          id="status-filter"
          aria-label="Account status"
          value={status}
          onChange={(e) => setParam({ status: e.target.value })}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="banned">Suspended</option>
        </select>
        <label className="relative min-w-56 flex-1 sm:max-w-xs">
          <span className="sr-only">Search users</span>
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input id="user-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, phone or plate" className={`${inputCls} pl-9`} />
        </label>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <Panel>
        {!data ? (
          <div className="flex justify-center p-10"><Spinner /></div>
        ) : data.users.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No users match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-5 py-3">User</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Account</th>
                  <th className="px-3 py-3">Verification</th>
                  <th className="px-3 py-3">Joined</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.users.map((u) => (
                  <tr key={u.id} className="align-top hover:bg-gray-50/60">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar user={u} size="h-9 w-9" />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 font-medium">
                            {u.name}
                            {u.isDemo && <span className="rounded bg-gray-100 px-1 text-[10px] font-normal text-gray-500">demo</span>}
                          </p>
                          <p className="truncate text-xs text-gray-500">{u.email}</p>
                          {u.phone && <p className="text-xs text-gray-500">{u.phone}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={ROLE_TONE[u.role]}>{u.role}</Badge>
                      {u.role === 'driver' && u.isOnline && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-gray-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {u.status === 'banned' ? (
                        <>
                          <Badge tone="red" icon={Ban}>Suspended</Badge>
                          {u.banReason && <p className="mt-1 max-w-48 text-xs text-gray-500" title={formatDateTime(u.bannedAt)}>{u.banReason}</p>}
                        </>
                      ) : (
                        <Badge tone="green">Active</Badge>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {u.role === 'driver' ? (
                        u.verified ? (
                          <Badge tone="green" icon={ShieldCheck}>Verified</Badge>
                        ) : (
                          <div className="flex flex-col items-start gap-1">
                            <DocBadge type="license" doc={u.documents?.license} />
                            <DocBadge type="insurance" doc={u.documents?.insurance} />
                          </div>
                        )
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-600" title={formatDateTime(u.createdAt)}>{timeAgo(u.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        {u.role === 'driver' && (
                          <button className={btn.secondary} onClick={() => setReviewing(u)}>
                            <FileText className="h-4 w-4" /> Documents
                          </button>
                        )}
                        {u.role !== 'admin' &&
                          (u.status === 'banned' ? (
                            <button className={btn.secondary} disabled={busyId === u.id} onClick={() => activate(u)}>
                              <RotateCcw className="h-4 w-4" /> Reactivate
                            </button>
                          ) : (
                            <button className={`${btn.ghost} text-red-600 hover:bg-red-50`} onClick={() => setBanning(u)}>
                              <Ban className="h-4 w-4" /> Suspend
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={(p) => setParam({ page: String(p) })} />}
      </Panel>

      <ReviewDialog user={reviewing} onClose={() => setReviewing(null)} onUpdated={replaceUser} />
      <BanDialog user={banning} onClose={() => setBanning(null)} onUpdated={replaceUser} />
    </>
  );
}
