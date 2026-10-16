export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const qs = (params = {}) => {
  const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A ban takes effect on the next request, wherever the user is in the app.
    if (data.code === 'account_banned' && !location.pathname.startsWith('/login')) {
      location.assign('/login?error=account_banned');
    }
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.code);
  }
  return data;
}

export const api = {
  // Auth
  authConfig: () => request('/auth/config'),
  me: () => request('/auth/me'),
  updateMe: (patch) => request('/auth/me', { method: 'PATCH', body: patch }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  devLogin: (payload) => request('/auth/dev-login', { method: 'POST', body: payload }),
  googleLoginUrl: (role) => `/api/auth/google?role=${encodeURIComponent(role)}`,

  // Rides
  estimate: (pickup, dropoff) => request('/rides/estimate', { method: 'POST', body: { pickup, dropoff } }),
  requestRide: (pickup, dropoff) => request('/rides', { method: 'POST', body: { pickup, dropoff } }),
  activeRide: () => request('/rides/active'),
  history: () => request('/rides/history'),
  availableRides: () => request('/rides/available'),
  acceptRide: (id) => request(`/rides/${id}/accept`, { method: 'POST' }),
  startRide: (id) => request(`/rides/${id}/start`, { method: 'POST' }),
  completeRide: (id) => request(`/rides/${id}/complete`, { method: 'POST' }),
  cancelRide: (id) => request(`/rides/${id}/cancel`, { method: 'POST' }),
  reportReasons: () => request('/rides/report-reasons'),
  reportRide: (id, reason, details) => request(`/rides/${id}/report`, { method: 'POST', body: { reason, details } }),

  // Driver
  setOnline: (isOnline) => request('/drivers/status', { method: 'PATCH', body: { isOnline } }),
  uploadDocument: (type, file) =>
    request(`/drivers/documents/${type}`, { method: 'POST', body: { fileName: file.name, fileSize: file.size } }),

  // Admin
  admin: {
    stats: () => request('/admin/stats'),
    users: (params) => request(`/admin/users${qs(params)}`),
    setUserStatus: (id, status, reason) => request(`/admin/users/${id}/status`, { method: 'PATCH', body: { status, reason } }),
    reviewDocument: (id, type, status, note) =>
      request(`/admin/users/${id}/documents/${type}`, { method: 'PATCH', body: { status, note } }),
    fleet: () => request('/admin/fleet'),
    activeTrips: () => request('/admin/trips/active'),
    rides: (params) => request(`/admin/rides${qs(params)}`),
    ride: (id) => request(`/admin/rides/${id}`),
    refund: (id, amount, reason) => request(`/admin/rides/${id}/refund`, { method: 'POST', body: { amount, reason } }),
    override: (id, status, reason) => request(`/admin/rides/${id}/override`, { method: 'POST', body: { status, reason } }),
    resolve: (id, resolution) => request(`/admin/rides/${id}/resolve`, { method: 'POST', body: { resolution } }),
  },
};

export const homePathFor = (role) => ({ driver: '/driver', admin: '/admin' })[role] ?? '/ride';

export const formatMoney = (amount, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount ?? 0);

export const formatNumber = (n) => new Intl.NumberFormat(undefined, { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n ?? 0);

export function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const formatDateTime = (iso) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';
