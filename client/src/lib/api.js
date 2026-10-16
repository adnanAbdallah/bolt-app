export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
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

  // Driver
  setOnline: (isOnline) => request('/drivers/status', { method: 'PATCH', body: { isOnline } }),
};

export const homePathFor = (role) => ({ driver: '/driver', admin: '/admin' })[role] ?? '/ride';

export const formatMoney = (amount, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
