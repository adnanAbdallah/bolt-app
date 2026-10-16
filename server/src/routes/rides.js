import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { ACTIVE_STATUSES, REPORT_REASONS, Ride, TRANSITIONS } from '../models/Ride.js';
import { estimateFare } from '../services/fare.js';
import { emitRideUpdate } from '../services/realtime.js';
import { populateParties, serializeRide } from '../services/rideView.js';

const router = Router();
router.use(requireAuth);

function readAddresses(body) {
  const pickup = typeof body?.pickup === 'string' ? body.pickup.trim() : '';
  const dropoff = typeof body?.dropoff === 'string' ? body.dropoff.trim() : '';
  if (!pickup || !dropoff) throw new HttpError(400, 'Pickup and dropoff are required');
  if (pickup.length > 200 || dropoff.length > 200) throw new HttpError(400, 'Address too long');
  if (pickup.toLowerCase() === dropoff.toLowerCase()) throw new HttpError(400, 'Pickup and dropoff must differ');
  return { pickup, dropoff };
}

/**
 * Atomically moves a ride from one of `from` statuses to `to`, guarded by `filter`,
 * and appends a timeline event. Returns the updated ride, or null if the ride was not
 * in an allowed state (e.g. another driver accepted it first).
 */
function transition(rideId, from, to, actor, filter = {}, extra = {}) {
  const allowedFrom = from.filter((s) => TRANSITIONS[s].includes(to));
  return populateParties(
    Ride.findOneAndUpdate(
      { _id: rideId, status: { $in: allowedFrom }, ...filter },
      {
        $set: { status: to, ...extra },
        $push: {
          events: {
            type: 'status',
            from: allowedFrom.length === 1 ? allowedFrom[0] : undefined,
            to,
            by: actor._id,
            byRole: actor.role,
          },
        },
      },
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

/** Send the result to the caller and push it live to everyone else involved. */
function respond(res, ride, status = 200) {
  res.status(status).json({ ride: serializeRide(ride) });
  emitRideUpdate(ride).catch((err) => console.error('ride broadcast failed', err));
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
    const field = req.user.role === 'driver' ? 'driverId' : 'passengerId';
    const rides = await populateParties(Ride.find({ [field]: req.user._id }).sort({ createdAt: -1 }).limit(50));
    res.json({ rides: rides.map((r) => serializeRide(r)) });
  }),
);

router.get('/report-reasons', (_req, res) => res.json({ reasons: REPORT_REASONS }));

/** Passenger or driver of a ride flags a problem; it shows up in the admin Disputes queue. */
router.post(
  '/:id/report',
  asyncHandler(async (req, res) => {
    const { reason, details } = req.body ?? {};
    if (!REPORT_REASONS[reason]) throw new HttpError(400, 'Choose a reason for the report');
    const text = typeof details === 'string' ? details.trim().slice(0, 1000) : '';

    const partyField = req.user.role === 'driver' ? 'driverId' : 'passengerId';
    const ride = await populateParties(
      Ride.findOneAndUpdate(
        {
          _id: req.params.id,
          [partyField]: req.user._id,
          status: { $in: ['ongoing', 'completed', 'cancelled'] },
          'report.reason': { $exists: false },
        },
        {
          $set: {
            report: { by: req.user._id, byRole: req.user.role, reason, details: text, createdAt: new Date() },
            'dispute.status': 'open',
          },
          $push: { events: { type: 'report', by: req.user._id, byRole: req.user.role, note: REPORT_REASONS[reason] } },
        },
        { new: true },
      ),
    );
    if (!ride) {
      const existing = await Ride.findOne({ _id: req.params.id, [partyField]: req.user._id }).select('status report').lean();
      if (!existing) throw new HttpError(404, 'Ride not found');
      if (existing.report?.reason) throw new HttpError(409, 'This ride has already been reported');
      throw new HttpError(409, `A ${existing.status} ride can't be reported yet`);
    }
    await respond(res, ride);
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
      events: [{ type: 'status', to: 'requested', by: req.user._id, byRole: 'passenger' }],
    });
    await populateParties(ride);
    await respond(res, ride, 201);
  }),
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { role, _id } = req.user;
    const stamp = { cancelledAt: new Date(), cancelledBy: role };
    let ride;
    if (role === 'passenger') {
      ride = await transition(req.params.id, ['requested', 'accepted'], 'cancelled', req.user, { passengerId: _id }, stamp);
    } else if (role === 'driver') {
      ride = await transition(req.params.id, ['accepted'], 'cancelled', req.user, { driverId: _id }, stamp);
    } else {
      throw new HttpError(403, 'Admins change rides from the dashboard (status override)');
    }
    await respond(res, await findOr409(req.params.id, ride, 'Ride can no longer be cancelled'));
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
    res.json({ rides: rides.map((r) => serializeRide(r)) });
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
    const ride = await transition(req.params.id, ['requested'], 'accepted', req.user, { driverId: null }, {
      driverId: req.user._id,
      acceptedAt: new Date(),
    });
    await respond(res, await findOr409(req.params.id, ride, 'Ride was already taken'));
  }),
);

router.post(
  '/:id/start',
  requireRole('driver'),
  asyncHandler(async (req, res) => {
    const ride = await transition(req.params.id, ['accepted'], 'ongoing', req.user, { driverId: req.user._id }, {
      startedAt: new Date(),
    });
    await respond(res, await findOr409(req.params.id, ride, 'Ride cannot be started'));
  }),
);

router.post(
  '/:id/complete',
  requireRole('driver'),
  asyncHandler(async (req, res) => {
    const ride = await transition(req.params.id, ['ongoing'], 'completed', req.user, { driverId: req.user._id }, {
      completedAt: new Date(),
    });
    await respond(res, await findOr409(req.params.id, ride, 'Ride cannot be completed'));
  }),
);

export default router;
