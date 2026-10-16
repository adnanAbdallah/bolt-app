import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { Ride, ACTIVE_STATUSES } from '../models/Ride.js';
import { User } from '../models/User.js';
import { AUTH_COOKIE, verifyAuthToken } from './token.js';
import { serializeRide } from './rideView.js';

/**
 * Socket.IO rooms:
 *   user:<id>  every socket of one user
 *   admins     all admin sockets
 *   drivers    all driver sockets
 *
 * Server -> client events:
 *   ride:updated    { ride }            passenger, driver and admins of that ride
 *   rides:changed   {}                  drivers: open request list changed, refetch
 *   fleet:update    { driver }          admins: a driver moved or changed state
 *   fleet:remove    { driverId }        admins: a driver went offline
 *   stats:changed   {}                  admins: dashboard numbers changed, refetch
 *   user:updated    { user }            that user: profile/verification changed
 *   account:banned  { reason }          that user: sign out immediately
 *
 * Client -> server:
 *   driver:location { lat, lng, heading?, accuracy?, simulated? }
 */

let io = null;
const LOCATION_MIN_INTERVAL_MS = 1500;

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((p) => p.trim().split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

export function initRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: env.clientUrl, credentials: true } });

  io.use(async (socket, next) => {
    try {
      const token = parseCookies(socket.handshake.headers.cookie)[AUTH_COOKIE];
      if (!token) return next(new Error('unauthorized'));
      const { sub } = verifyAuthToken(token);
      const user = await User.findById(sub).select('role status name').lean();
      if (!user || user.status === 'banned') return next(new Error('unauthorized'));
      socket.data.user = { id: user._id.toString(), role: user.role };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.data.user;
    socket.join(`user:${id}`);
    if (role === 'admin') socket.join('admins');
    if (role === 'driver') {
      socket.join('drivers');
      let last = 0;
      socket.on('driver:location', async (payload) => {
        const now = Date.now();
        if (now - last < LOCATION_MIN_INTERVAL_MS) return;
        last = now;
        await updateDriverLocation(id, payload).catch((err) => console.error('location update failed', err));
      });
    }
  });

  return io;
}

const valid = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

export async function updateDriverLocation(driverId, { lat, lng, heading, accuracy, simulated } = {}) {
  if (!valid(lat, -90, 90) || !valid(lng, -180, 180)) return;
  const location = {
    lat,
    lng,
    heading: valid(heading, 0, 360) ? heading : null,
    accuracy: valid(accuracy, 0, 1e5) ? accuracy : null,
    simulated: Boolean(simulated),
    updatedAt: new Date(),
  };
  // Only online, active drivers are tracked.
  const driver = await User.findOneAndUpdate(
    { _id: driverId, role: 'driver', isOnline: true, status: { $ne: 'banned' } },
    { $set: { location } },
    { new: true },
  );
  if (driver) await broadcastFleetUpdate(driver);
}

/** Shape used by the admin fleet map. */
export async function fleetEntry(driver, activeRide) {
  const ride =
    activeRide === undefined
      ? await Ride.findOne({ driverId: driver._id, status: { $in: ['accepted', 'ongoing'] } })
          .select('status pickupLocation dropoffLocation')
          .lean()
      : activeRide;
  return {
    id: driver._id.toString(),
    name: driver.name,
    avatar: driver.avatar ?? null,
    phone: driver.phone ?? null,
    vehicle: driver.vehicle ?? null,
    isDemo: Boolean(driver.isDemo),
    location: driver.location?.lat != null ? driver.location : null,
    trip: ride
      ? {
          id: ride._id.toString(),
          status: ride.status,
          pickup: ride.pickupLocation?.address,
          dropoff: ride.dropoffLocation?.address,
        }
      : null,
  };
}

export async function broadcastFleetUpdate(driver, activeRide) {
  if (!io) return;
  io.to('admins').emit('fleet:update', { driver: await fleetEntry(driver, activeRide) });
}

export function broadcastFleetRemove(driverId) {
  io?.to('admins').emit('fleet:remove', { driverId: driverId.toString() });
}

export function emitStatsChanged() {
  io?.to('admins').emit('stats:changed', {});
}

/** Push a ride to everyone who should see it, and nudge drivers + admin dashboards. */
export async function emitRideUpdate(ride) {
  if (!io) return;
  const passengerId = (ride.passengerId?._id ?? ride.passengerId)?.toString();
  const driverId = (ride.driverId?._id ?? ride.driverId)?.toString();
  const partyView = { ride: serializeRide(ride) };
  if (passengerId) io.to(`user:${passengerId}`).emit('ride:updated', partyView);
  if (driverId) io.to(`user:${driverId}`).emit('ride:updated', partyView);
  io.to('admins').emit('ride:updated', { ride: serializeRide(ride, { admin: true }) });
  io.to('drivers').emit('rides:changed', {});
  emitStatsChanged();

  // A driver's trip state shows on the fleet map.
  if (driverId) {
    const driver = await User.findById(driverId);
    if (driver?.isOnline) {
      const onTrip = ACTIVE_STATUSES.includes(ride.status) && ride.status !== 'requested' ? ride : null;
      await broadcastFleetUpdate(driver, onTrip);
    }
  }
}

export function emitUserUpdated(user) {
  io?.to(`user:${user._id}`).emit('user:updated', { user: user.toPublicJSON() });
  emitStatsChanged();
}

export function forceSignOut(userId, reason) {
  if (!io) return;
  const room = `user:${userId}`;
  io.to(room).emit('account:banned', { reason: reason ?? null });
  io.in(room).disconnectSockets(true);
}
