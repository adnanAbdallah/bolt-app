import { Router } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { ACTIVE_STATUSES, OVERRIDE_STATUSES, Ride } from '../models/Ride.js';
import { ACCOUNT_STATUSES, DOCUMENT_TYPES, ROLES, User, serializeDocuments } from '../models/User.js';
import {
  broadcastFleetRemove,
  emitRideUpdate,
  emitStatsChanged,
  emitUserUpdated,
  fleetEntry,
  forceSignOut,
} from '../services/realtime.js';
import { populateParties, serializeRide } from '../services/rideView.js';

const router = Router();
// Every route below is admin-only. The client hides /admin too, but this is the real guard.
router.use(requireAdmin);

const round2 = (n) => Math.round(n * 100) / 100;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isId = (id) => mongoose.isValidObjectId(id);

function startOfDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

function readReason(body, field = 'reason', { required = true } = {}) {
  const value = typeof body?.[field] === 'string' ? body[field].trim().slice(0, 500) : '';
  if (required && !value) throw new HttpError(400, `A ${field} is required`);
  return value;
}

// ---------------------------------------------------------------- Stats

/** Net revenue = completed fares minus refunds, grouped by completion time. */
async function revenueBetween(from, to) {
  const match = { status: 'completed' };
  if (from || to) match.completedAt = { ...(from && { $gte: from }), ...(to && { $lt: to }) };
  const [row] = await Ride.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        gross: { $sum: '$fare' },
        refunds: { $sum: '$refundedAmount' },
        trips: { $sum: 1 },
      },
    },
  ]);
  const gross = round2(row?.gross ?? 0);
  const refunds = round2(row?.refunds ?? 0);
  return { gross, refunds, net: round2(gross - refunds), trips: row?.trips ?? 0 };
}

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const today = startOfDay();
    const yesterday = startOfDay(-1);

    const [
      ridesToday,
      ridesYesterday,
      todayByStatus,
      revenueToday,
      revenueYesterday,
      revenueAllTime,
      usersByRole,
      bannedUsers,
      newUsersToday,
      driversOnline,
      pendingVerifications,
      openDisputes,
      activeTrips,
      waitingRequests,
    ] = await Promise.all([
      Ride.countDocuments({ createdAt: { $gte: today } }),
      Ride.countDocuments({ createdAt: { $gte: yesterday, $lt: today } }),
      Ride.aggregate([{ $match: { createdAt: { $gte: today } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      revenueBetween(today),
      revenueBetween(yesterday, today),
      revenueBetween(),
      User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]),
      User.countDocuments({ status: 'banned' }),
      User.countDocuments({ createdAt: { $gte: today } }),
      User.countDocuments({ role: 'driver', isOnline: true, status: { $ne: 'banned' } }),
      User.countDocuments({
        role: 'driver',
        $or: DOCUMENT_TYPES.map((t) => ({ [`documents.${t}.status`]: 'pending' })),
      }),
      Ride.countDocuments({ 'dispute.status': 'open' }),
      Ride.countDocuments({ status: { $in: ['accepted', 'ongoing'] } }),
      Ride.countDocuments({ status: 'requested' }),
    ]);

    const roleCounts = Object.fromEntries(ROLES.map((r) => [r, 0]));
    for (const { _id, n } of usersByRole) roleCounts[_id] = n;
    const statusCounts = Object.fromEntries(['requested', 'accepted', 'ongoing', 'completed', 'cancelled'].map((s) => [s, 0]));
    for (const { _id, n } of todayByStatus) statusCounts[_id] = n;

    res.json({
      currency: env.fare.currency,
      generatedAt: new Date(),
      rides: { today: ridesToday, yesterday: ridesYesterday, todayByStatus: statusCounts, activeTrips, waitingRequests },
      revenue: { today: revenueToday, yesterday: revenueYesterday, allTime: revenueAllTime },
      users: {
        total: Object.values(roleCounts).reduce((a, b) => a + b, 0),
        byRole: roleCounts,
        banned: bannedUsers,
        newToday: newUsersToday,
      },
      drivers: { online: driversOnline, pendingVerifications },
      disputes: { open: openDisputes },
    });
  }),
);

// ---------------------------------------------------------------- Users & drivers

function adminUserView(u) {
  return {
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    phone: u.phone ?? null,
    avatar: u.avatar ?? null,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    bannedAt: u.bannedAt ?? null,
    banReason: u.banReason ?? null,
    isDemo: Boolean(u.isDemo),
    ...(u.role === 'driver' && {
      isOnline: u.isOnline,
      vehicle: u.vehicle ?? null,
      documents: serializeDocuments(u.documents),
      verified: u.isVerifiedDriver(),
    }),
  };
}

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { role, status, q, verification } = req.query;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));

    const filter = {};
    if (ROLES.includes(role)) filter.role = role;
    // Accounts created before Level 2 may have no status field; they count as active.
    if (status === 'banned') filter.status = 'banned';
    else if (status === 'active') filter.status = { $ne: 'banned' };
    if (typeof q === 'string' && q.trim()) {
      const rx = new RegExp(escapeRegex(q.trim().slice(0, 80)), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { 'vehicle.plate': rx }];
    }
    if (verification === 'pending') {
      filter.role = 'driver';
      filter.$and = [{ $or: DOCUMENT_TYPES.map((t) => ({ [`documents.${t}.status`]: 'pending' })) }];
    }

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(filter),
    ]);
    res.json({ users: users.map(adminUserView), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }),
);

/** Cancel a suspended user's not-yet-started rides so nobody is left waiting on them. */
async function cancelOpenRidesFor(user, admin) {
  const field = user.role === 'driver' ? 'driverId' : 'passengerId';
  const rides = await Ride.find({ [field]: user._id, status: { $in: ['requested', 'accepted'] } }).select('_id status');
  for (const { _id, status } of rides) {
    const ride = await populateParties(
      Ride.findOneAndUpdate(
        { _id, status },
        {
          $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'admin' },
          $push: { events: { type: 'status', from: status, to: 'cancelled', by: admin._id, byRole: 'admin', note: 'Account suspended' } },
        },
        { new: true },
      ),
    );
    if (ride) emitRideUpdate(ride).catch(console.error);
  }
  return rides.length;
}

router.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const { status } = req.body ?? {};
    if (!ACCOUNT_STATUSES.includes(status)) throw new HttpError(400, `status must be one of: ${ACCOUNT_STATUSES.join(', ')}`);

    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, 'User not found');
    if (user._id.equals(req.user._id)) throw new HttpError(400, "You can't change your own account status");
    if (user.role === 'admin') throw new HttpError(403, 'Admins can only be removed through ADMIN_EMAILS');
    if (user.status === status) return res.json({ user: adminUserView(user), cancelledRides: 0 });

    let cancelledRides = 0;
    if (status === 'banned') {
      user.status = 'banned';
      user.bannedAt = new Date();
      user.banReason = readReason(req.body);
      if (user.isOnline) {
        user.isOnline = false;
        broadcastFleetRemove(user._id);
      }
      await user.save();
      forceSignOut(user._id, user.banReason);
      cancelledRides = await cancelOpenRidesFor(user, req.user);
    } else {
      user.status = 'active';
      user.bannedAt = undefined;
      user.banReason = undefined;
      await user.save();
    }
    emitStatsChanged();
    res.json({ user: adminUserView(user), cancelledRides });
  }),
);

router.patch(
  '/users/:id/documents/:type',
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const { type } = req.params;
    if (!DOCUMENT_TYPES.includes(type)) throw new HttpError(400, `Unknown document type: ${type}`);
    const { status } = req.body ?? {};
    if (!['approved', 'rejected'].includes(status)) throw new HttpError(400, 'status must be approved or rejected');
    const note = readReason(req.body, 'note', { required: status === 'rejected' });

    const user = await User.findOne({ _id: req.params.id, role: 'driver' });
    if (!user) throw new HttpError(404, 'Driver not found');
    const doc = user.documents?.[type];
    if (!doc || doc.status === 'missing') throw new HttpError(409, 'The driver has not uploaded this document yet');

    user.set(`documents.${type}.status`, status);
    user.set(`documents.${type}.note`, note || undefined);
    user.set(`documents.${type}.reviewedAt`, new Date());
    user.set(`documents.${type}.reviewedBy`, req.user._id);

    // A driver who loses verification is taken offline, unless mid-trip.
    if (status === 'rejected' && user.isOnline && env.requireDriverVerification) {
      const busy = await Ride.exists({ driverId: user._id, status: { $in: ['accepted', 'ongoing'] } });
      if (!busy) {
        user.isOnline = false;
        broadcastFleetRemove(user._id);
      }
    }
    await user.save();
    emitUserUpdated(user);
    res.json({ user: adminUserView(user) });
  }),
);

// ---------------------------------------------------------------- Fleet & trips

router.get(
  '/fleet',
  asyncHandler(async (_req, res) => {
    const drivers = await User.find({ role: 'driver', isOnline: true, status: { $ne: 'banned' } });
    const trips = await Ride.find({ driverId: { $in: drivers.map((d) => d._id) }, status: { $in: ['accepted', 'ongoing'] } })
      .select('driverId status pickupLocation dropoffLocation')
      .lean();
    const tripByDriver = new Map(trips.map((t) => [t.driverId.toString(), t]));
    res.json({
      drivers: await Promise.all(drivers.map((d) => fleetEntry(d, tripByDriver.get(d._id.toString()) ?? null))),
    });
  }),
);

router.get(
  '/trips/active',
  asyncHandler(async (_req, res) => {
    const rides = await populateParties(Ride.find({ status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: -1 }).limit(200));
    res.json({ rides: rides.map((r) => serializeRide(r, { admin: true })) });
  }),
);

// ---------------------------------------------------------------- Disputes

const DISPUTE_VIEWS = {
  open: { 'dispute.status': 'open' },
  cancelled: { status: 'cancelled' },
  reported: { 'report.reason': { $exists: true } },
  resolved: { 'dispute.status': 'resolved' },
  all: { $or: [{ status: 'cancelled' }, { 'report.reason': { $exists: true } }] },
};

router.get(
  '/rides',
  asyncHandler(async (req, res) => {
    const view = DISPUTE_VIEWS[req.query.view] ? req.query.view : 'all';
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));

    const [rides, total, counts] = await Promise.all([
      populateParties(
        Ride.find(DISPUTE_VIEWS[view])
          .sort({ 'report.createdAt': -1, updatedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
      ),
      Ride.countDocuments(DISPUTE_VIEWS[view]),
      Promise.all(Object.entries(DISPUTE_VIEWS).map(async ([k, f]) => [k, await Ride.countDocuments(f)])),
    ]);
    res.json({
      rides: rides.map((r) => serializeRide(r, { admin: true })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      counts: Object.fromEntries(counts),
    });
  }),
);

router.get(
  '/rides/:id',
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const ride = await populateParties(Ride.findById(req.params.id));
    if (!ride) throw new HttpError(404, 'Ride not found');
    res.json({ ride: serializeRide(ride, { admin: true }) });
  }),
);

async function adminRespond(res, ride) {
  res.json({ ride: serializeRide(ride, { admin: true }) });
  emitRideUpdate(ride).catch(console.error);
}

router.post(
  '/rides/:id/refund',
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const amount = round2(Number(req.body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Refund amount must be greater than 0');
    const reason = readReason(req.body);

    // Atomic: the refund total can never exceed the fare, even with concurrent refunds.
    const ride = await populateParties(
      Ride.findOneAndUpdate(
        {
          _id: req.params.id,
          status: 'completed',
          $expr: { $lte: [{ $add: ['$refundedAmount', amount] }, { $add: ['$fare', 0.001] }] },
        },
        {
          $inc: { refundedAmount: amount },
          $push: { events: { type: 'refund', amount, note: reason, by: req.user._id, byRole: 'admin' } },
        },
        { new: true },
      ),
    );
    if (!ride) {
      const current = await Ride.findById(req.params.id).select('status fare refundedAmount currency').lean();
      if (!current) throw new HttpError(404, 'Ride not found');
      if (current.status !== 'completed') throw new HttpError(409, `Only completed rides can be refunded (ride is ${current.status})`);
      const left = round2(current.fare - (current.refundedAmount ?? 0));
      throw new HttpError(409, `Refund exceeds the remaining ${left.toFixed(2)} ${current.currency}`);
    }
    await adminRespond(res, ride);
  }),
);

router.post(
  '/rides/:id/override',
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const { status } = req.body ?? {};
    if (!OVERRIDE_STATUSES.includes(status)) {
      throw new HttpError(400, `Status can be overridden to: ${OVERRIDE_STATUSES.join(', ')}`);
    }
    const reason = readReason(req.body);

    const current = await Ride.findById(req.params.id).select('status refundedAmount driverId').lean();
    if (!current) throw new HttpError(404, 'Ride not found');
    if (current.status === status) throw new HttpError(409, `Ride is already ${status}`);
    if (status === 'completed' && !current.driverId) {
      throw new HttpError(409, 'A ride that no driver accepted cannot be marked completed');
    }
    if (status === 'cancelled' && current.refundedAmount > 0) {
      throw new HttpError(409, 'This ride has refunds; cancel would double-count them. Refund the remainder instead.');
    }

    const now = new Date();
    const set =
      status === 'completed'
        ? { status, completedAt: now }
        : { status, cancelledAt: now, cancelledBy: 'admin' };

    // Guarded on the status we just read, so a concurrent driver action isn't silently overwritten.
    const ride = await populateParties(
      Ride.findOneAndUpdate(
        { _id: req.params.id, status: current.status },
        {
          $set: set,
          $push: { events: { type: 'override', from: current.status, to: status, note: reason, by: req.user._id, byRole: 'admin' } },
        },
        { new: true },
      ),
    );
    if (!ride) throw new HttpError(409, 'The ride changed while you were editing it. Reload and try again.');
    await adminRespond(res, ride);
  }),
);

router.post(
  '/rides/:id/resolve',
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const resolution = readReason(req.body, 'resolution');
    const ride = await populateParties(
      Ride.findOneAndUpdate(
        { _id: req.params.id, 'dispute.status': 'open' },
        {
          $set: {
            'dispute.status': 'resolved',
            'dispute.resolution': resolution,
            'dispute.resolvedBy': req.user._id,
            'dispute.resolvedAt': new Date(),
          },
          $push: { events: { type: 'resolve', note: resolution, by: req.user._id, byRole: 'admin' } },
        },
        { new: true },
      ),
    );
    if (!ride) {
      const exists = await Ride.exists({ _id: req.params.id });
      throw new HttpError(exists ? 409 : 404, exists ? 'This ride has no open dispute' : 'Ride not found');
    }
    await adminRespond(res, ride);
  }),
);

export default router;
