import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { Ride, ACTIVE_STATUSES, TRAIL_MAX_POINTS, TRAIL_MIN_SPACING_M } from '../models/Ride.js';
import { distanceM } from '../lib/geometry.js';
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
 *   ride:driver-location { rideId, location }  ONLY the passenger of the driver's active ride
 *   rides:changed   {}                  drivers: open request list changed, refetch
 *   fleet:update    { driver }          admins: a driver moved or changed state
 *   fleet:remove    { driverId }        admins: a driver went offline
 *   stats:changed   {}                  admins: dashboard numbers changed, refetch
 *   user:updated    { user }            that user: profile/verification changed
 *   account:banned  { reason }          that user: sign out immediately
 *
 * Client -> server:
 *   driver:location { lat, lng, heading?, accuracy?, simulated? }, ack?(result)
 *     result = { ok: true } | { ok: false, reason }
 */

let io = null;
// Dev stepping sends on every "Next" press; real GPS is throttled harder.
const LOCATION_MIN_INTERVAL_MS = env.locationMode === 'gps' ? 1500 : 200;
const GPS_MAX_ACCURACY_M = 100;
const GPS_MAX_SPEED_KMH = 150;

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
      socket.on('driver:location', async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const now = Date.now();
        if (now - last < LOCATION_MIN_INTERVAL_MS) return reply({ ok: false, reason: 'too_frequent' });
        last = now;
        try {
          reply(await updateDriverLocation(id, payload));
        } catch (err) {
          console.error('location update failed', err);
          reply({ ok: false, reason: 'server_error' });
        }
      });
    }
  });

  return io;
}

const valid = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

/**
 * Validate and store a driver position, then fan it out:
 *  - breadcrumb on the active ride's trail (every TRAIL_MIN_SPACING_M metres),
 *  - `ride:driver-location` to that ride's passenger only,
 *  - `fleet:update` to admins.
 * `trusted` is for the server's own demo fleet, which bypasses the gps-mode checks.
 * Returns { ok: true } or { ok: false, reason }.
 */
export async function updateDriverLocation(driverId, payload = {}, { trusted = false } = {}) {
  const { lat, lng, heading, accuracy } = payload;
  const simulated = Boolean(payload.simulated);
  if (!valid(lat, -90, 90) || !valid(lng, -180, 180)) return { ok: false, reason: 'invalid_coordinates' };

  const gps = env.locationMode === 'gps' && !trusted;
  if (gps && simulated) return { ok: false, reason: 'simulated_not_allowed' };
  if (gps && valid(accuracy, 0, 1e7) && accuracy > GPS_MAX_ACCURACY_M) return { ok: false, reason: 'low_accuracy' };

  // Only online, active drivers are tracked.
  const driver = await User.findOne({ _id: driverId, role: 'driver', isOnline: true, status: { $ne: 'banned' } });
  if (!driver) return { ok: false, reason: 'offline' };

  const now = new Date();
  const prev = driver.location;
  if (gps && prev?.lat != null && prev.updatedAt) {
    const hours = (now - prev.updatedAt) / 3_600_000;
    const km = distanceM(prev, { lat, lng }) / 1000;
    // Ignore implausible jumps (GPS glitches) unless the last fix is old.
    if (hours < 5 / 60 && km > 0.05 && km / Math.max(hours, 1 / 3600) > GPS_MAX_SPEED_KMH) {
      return { ok: false, reason: 'implausible_jump' };
    }
  }

  driver.location = {
    lat,
    lng,
    heading: valid(heading, 0, 360) ? heading : null,
    accuracy: valid(accuracy, 0, 1e5) ? accuracy : null,
    simulated,
    updatedAt: now,
  };
  await User.updateOne({ _id: driver._id }, { $set: { location: driver.location } });

  const ride = await Ride.findOne({ driverId: driver._id, status: { $in: ['accepted', 'ongoing'] } })
    .select({ passengerId: 1, status: 1, pickupLocation: 1, dropoffLocation: 1, trail: { $slice: -1 } })
    .lean();

  if (ride) {
    const last = ride.trail?.[0];
    if (!last || distanceM(last, { lat, lng }) >= TRAIL_MIN_SPACING_M) {
      await Ride.updateOne(
        { _id: ride._id },
        { $push: { trail: { $each: [{ lat, lng, at: now }], $slice: -TRAIL_MAX_POINTS } } },
      );
    }
    io?.to(`user:${ride.passengerId}`).emit('ride:driver-location', {
      rideId: ride._id.toString(),
      location: driver.location,
    });
  }
  await broadcastFleetUpdate(driver, ride ?? null);
  return { ok: true };
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
