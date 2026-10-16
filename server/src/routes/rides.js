import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { ACTIVE_STATUSES, REPORT_REASONS, Ride, TRANSITIONS } from '../models/Ride.js';
import { env } from '../config/env.js';
import { distanceM, offset } from '../lib/geometry.js';
import { User } from '../models/User.js';
import { estimateFare, resolvePlace } from '../services/fare.js';
import { reverseGeocode } from '../services/geo.js';
import { broadcastFleetUpdate, emitRideUpdate } from '../services/realtime.js';
import { getRoute } from '../services/routing.js';
import { populateParties, serializeOpenRequest, serializeRide } from '../services/rideView.js';

const router = Router();
router.use(requireAuth);

const MIN_TRIP_M = 100;

/** Pickup/dropoff as { address, lat, lng } (search result or map pin) or a plain address string. */
function readPlaces(body) {
  if (!body?.pickup || !body?.dropoff) throw new HttpError(400, 'Pickup and dropoff are required');
  if (typeof body.pickup === 'string' && body.pickup.length > 200) throw new HttpError(400, 'Address too long');
  if (typeof body.dropoff === 'string' && body.dropoff.length > 200) throw new HttpError(400, 'Address too long');
  const pickup = resolvePlace(body.pickup);
  const dropoff = resolvePlace(body.dropoff);
  if (!pickup || !dropoff) throw new HttpError(400, 'Choose pickup and dropoff from the suggestions or the map');
  if (distanceM(pickup, dropoff) < MIN_TRIP_M) throw new HttpError(400, 'Pickup and dropoff are too close together');
  return { pickup, dropoff };
}

/** Best-effort neighbourhood name for the pickup, so drivers see an area before accepting. */
async function areaFor(place) {
  if (place.area) return place.area;
  const timeout = new Promise((r) => setTimeout(() => r(null), 2500));
  const found = await Promise.race([reverseGeocode(place.lat, place.lng), timeout]);
  return found?.area ?? null;
}

const SIM_RELOCATE_KM = 15;

/**
 * Road route from the driver's current position to the pickup, stored on the ride.
 * In simulated mode a driver with no position, or one far away (e.g. the passenger
 * booked in their real city while the demo map is elsewhere), is first placed ~1.5 km
 * from the pickup so dev testing works anywhere.
 */
async function attachApproachRoute(ride, driverId) {
  const driver = await User.findById(driverId);
  const pickup = ride.pickupLocation;
  if (!driver || pickup?.lat == null) return ride;
  let from = driver.location?.lat != null ? driver.location : null;
  if (env.locationMode === 'simulated' && (!from || distanceM(from, pickup) / 1000 > SIM_RELOCATE_KM)) {
    const p = offset(pickup, 1500, Math.random() * 360);
    driver.location = { lat: p.lat, lng: p.lng, heading: null, simulated: true, updatedAt: new Date() };
    await driver.save();
    from = driver.location;
    broadcastFleetUpdate(driver).catch(console.error);
  }
  if (!from) return ride; // gps mode, no fix yet: clients draw a straight line once a fix arrives
  const approachRoute = await getRoute(from, pickup);
  return populateParties(Ride.findByIdAndUpdate(ride._id, { $set: { approachRoute } }, { new: true }));
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
    const { pickup, dropoff } = readPlaces(req.body);
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
    if (!ride) return res.json({ ride: null });
    const view = serializeRide(ride);
    // A passenger gets their own driver's last known position while the ride is active.
    if (req.user.role === 'passenger' && ride.driverId && ['accepted', 'ongoing'].includes(ride.status)) {
      const d = await User.findById(ride.driverId._id ?? ride.driverId).select('location').lean();
      view.driverLocation = d?.location?.lat != null ? d.location : null;
    }
    res.json({ ride: view });
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
    const { pickup, dropoff } = readPlaces(req.body);

    const existing = await Ride.exists({ passengerId: req.user._id, status: { $in: ACTIVE_STATUSES } });
    if (existing) throw new HttpError(409, 'You already have an active ride');

    // Always price server-side; never trust a client-supplied fare.
    const quote = await estimateFare(pickup, dropoff);
    const area = await areaFor(quote.pickup);
    const ride = await Ride.create({
      passengerId: req.user._id,
      pickupLocation: { ...quote.pickup, area: area ?? undefined },
      dropoffLocation: quote.dropoff,
      route: quote.route,
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
    res.json({ rides: rides.map(serializeOpenRequest) });
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
    const accepted = await findOr409(req.params.id, ride, 'Ride was already taken');
    await respond(res, await attachApproachRoute(accepted, req.user._id));
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
