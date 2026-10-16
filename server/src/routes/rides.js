import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { ACTIVE_STATUSES, Ride, TRANSITIONS } from '../models/Ride.js';
import { estimateFare } from '../services/fare.js';

const router = Router();
router.use(requireAuth);

const PARTY_FIELDS = 'name avatar phone vehicle';
const populateParties = (q) =>
  q.populate([
    { path: 'passengerId', select: PARTY_FIELDS },
    { path: 'driverId', select: PARTY_FIELDS },
  ]);

function serializeRide(ride) {
  const o = ride.toObject({ versionKey: false });
  const party = (p) =>
    p && typeof p === 'object' && p.name
      ? { id: p._id.toString(), name: p.name, avatar: p.avatar ?? null, phone: p.phone ?? null, vehicle: p.vehicle ?? null }
      : null;
  return {
    id: o._id.toString(),
    status: o.status,
    pickupLocation: o.pickupLocation,
    dropoffLocation: o.dropoffLocation,
    fare: o.fare,
    currency: o.currency,
    distanceKm: o.distanceKm,
    durationMin: o.durationMin,
    surgeMultiplier: o.surgeMultiplier,
    passenger: party(o.passengerId),
    driver: party(o.driverId),
    createdAt: o.createdAt,
    acceptedAt: o.acceptedAt,
    startedAt: o.startedAt,
    completedAt: o.completedAt,
    cancelledAt: o.cancelledAt,
    cancelledBy: o.cancelledBy,
  };
}

function readAddresses(body) {
  const pickup = typeof body?.pickup === 'string' ? body.pickup.trim() : '';
  const dropoff = typeof body?.dropoff === 'string' ? body.dropoff.trim() : '';
  if (!pickup || !dropoff) throw new HttpError(400, 'Pickup and dropoff are required');
  if (pickup.length > 200 || dropoff.length > 200) throw new HttpError(400, 'Address too long');
  if (pickup.toLowerCase() === dropoff.toLowerCase()) throw new HttpError(400, 'Pickup and dropoff must differ');
  return { pickup, dropoff };
}

/**
 * Atomically moves a ride from one of `from` statuses to `to`, guarded by `filter`.
 * Returns the updated ride, or null if the ride was not in an allowed state
 * (e.g. another driver accepted it first).
 */
function transition(rideId, from, to, filter = {}, extra = {}) {
  const allowedFrom = from.filter((s) => TRANSITIONS[s].includes(to));
  return populateParties(
    Ride.findOneAndUpdate(
      { _id: rideId, status: { $in: allowedFrom }, ...filter },
      { $set: { status: to, ...extra } },
      { new: true },
    ),
  );
}

async function findOr409(rideId, ride, message) {
  if (ride) return ride;
  const current = await Ride.findById(rideId).select('status').lean();
  if (!current) throw new HttpError(404, 'Ride not found');
  throw new HttpError(409, `${message} (ride is ${current.status})`);
}

// ---------- Shared ----------

router.post(
  '/estimate',
  asyncHandler(async (req, res) => {
    const { pickup, dropoff } = readAddresses(req.body);
    res.json(await estimateFare(pickup, dropoff));
  }),
);

/** The caller's current in-progress ride (as passenger or driver), or null. */
router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const field = req.user.role === 'driver' ? 'driverId' : 'passengerId';
    const ride = await populateParties(
      Ride.findOne({ [field]: req.user._id, status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: -1 }),
    );
    res.json({ ride: ride ? serializeRide(ride) : null });
  }),
);

router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const filter =
      req.user.role === 'admin'
        ? {}
        : { [req.user.role === 'driver' ? 'driverId' : 'passengerId']: req.user._id };
    const rides = await populateParties(Ride.find(filter).sort({ createdAt: -1 }).limit(50));
    res.json({ rides: rides.map(serializeRide) });
  }),
);

// ---------- Passenger ----------

router.post(
  '/',
  requireRole('passenger'),
  asyncHandler(async (req, res) => {
    const { pickup, dropoff } = readAddresses(req.body);

    const existing = await Ride.exists({ passengerId: req.user._id, status: { $in: ACTIVE_STATUSES } });
    if (existing) throw new HttpError(409, 'You already have an active ride');

    // Always price server-side; never trust a client-supplied fare.
    const quote = await estimateFare(pickup, dropoff);
    const ride = await Ride.create({
      passengerId: req.user._id,
      pickupLocation: quote.pickup,
      dropoffLocation: quote.dropoff,
      fare: quote.fare,
      currency: quote.currency,
      distanceKm: quote.distanceKm,
      durationMin: quote.durationMin,
      surgeMultiplier: quote.surgeMultiplier,
    });
    await populateParties(ride);
    res.status(201).json({ ride: serializeRide(ride) });
  }),
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { role, _id } = req.user;
    let ride;
    if (role === 'passenger') {
      ride = await transition(req.params.id, ['requested', 'accepted'], 'cancelled', { passengerId: _id }, {
        cancelledAt: new Date(),
        cancelledBy: 'passenger',
      });
    } else if (role === 'driver') {
      ride = await transition(req.params.id, ['accepted'], 'cancelled', { driverId: _id }, {
        cancelledAt: new Date(),
        cancelledBy: 'driver',
      });
    } else {
      ride = await transition(req.params.id, ACTIVE_STATUSES, 'cancelled', {}, {
        cancelledAt: new Date(),
        cancelledBy: 'admin',
      });
    }
    ride = await findOr409(req.params.id, ride, 'Ride can no longer be cancelled');
    res.json({ ride: serializeRide(ride) });
  }),
);

// ---------- Driver ----------

router.get(
  '/available',
  requireRole('driver'),
  asyncHandler(async (req, res) => {
    if (!req.user.isOnline) return res.json({ rides: [] });
    const rides = await populateParties(
      Ride.find({ status: 'requested', driverId: null }).sort({ createdAt: 1 }).limit(20),
    );
    res.json({ rides: rides.map(serializeRide) });
  }),
);

router.post(
  '/:id/accept',
  requireRole('driver'),
  asyncHandler(async (req, res) => {
    if (!req.user.isOnline) throw new HttpError(400, 'Go online to accept rides');

    const busy = await Ride.exists({ driverId: req.user._id, status: { $in: ['accepted', 'ongoing'] } });
    if (busy) throw new HttpError(409, 'Finish your current ride first');

    // Atomic: only succeeds if the ride is still unassigned, so two drivers can't both win.
    const ride = await transition(req.params.id, ['requested'], 'accepted', { driverId: null }, {
      driverId: req.user._id,
      acceptedAt: new Date(),
    });
    res.json({ ride: serializeRide(await findOr409(req.params.id, ride, 'Ride was already taken')) });
  }),
);

router.post(
  '/:id/start',
  requireRole('driver'),
  asyncHandler(async (req, res) => {
    const ride = await transition(req.params.id, ['accepted'], 'ongoing', { driverId: req.user._id }, {
      startedAt: new Date(),
    });
    res.json({ ride: serializeRide(await findOr409(req.params.id, ride, 'Ride cannot be started')) });
  }),
);

router.post(
  '/:id/complete',
  requireRole('driver'),
  asyncHandler(async (req, res) => {
    const ride = await transition(req.params.id, ['ongoing'], 'completed', { driverId: req.user._id }, {
      completedAt: new Date(),
    });
    res.json({ ride: serializeRide(await findOr409(req.params.id, ride, 'Ride cannot be completed')) });
  }),
);

export default router;
