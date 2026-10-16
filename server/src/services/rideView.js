/** Shared ride population + JSON shape for API responses and socket events. */

const PARTY_FIELDS = 'name email avatar phone vehicle status';

export const populateParties = (q) =>
  q.populate([
    { path: 'passengerId', select: PARTY_FIELDS },
    { path: 'driverId', select: PARTY_FIELDS },
  ]);

const party = (p, admin) =>
  p && typeof p === 'object' && p.name
    ? {
        id: p._id.toString(),
        name: p.name,
        avatar: p.avatar ?? null,
        phone: p.phone ?? null,
        vehicle: p.vehicle ?? null,
        ...(admin && { email: p.email, status: p.status }),
      }
    : null;

const routeView = (r) =>
  r?.coordinates?.length >= 2
    ? { coordinates: r.coordinates, distanceKm: r.distanceKm, durationMin: r.durationMin, source: r.source }
    : null;

/** `admin: true` adds contact details, the driver's breadcrumb trail and the full audit trail. */
export function serializeRide(ride, { admin = false } = {}) {
  const o = ride.toObject ? ride.toObject({ versionKey: false }) : ride;
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
    refundedAmount: o.refundedAmount ?? 0,
    route: routeView(o.route),
    approachRoute: routeView(o.approachRoute),
    passenger: party(o.passengerId, admin),
    driver: party(o.driverId, admin),
    createdAt: o.createdAt,
    acceptedAt: o.acceptedAt,
    startedAt: o.startedAt,
    completedAt: o.completedAt,
    cancelledAt: o.cancelledAt,
    cancelledBy: o.cancelledBy,
    report: o.report?.reason
      ? {
          reason: o.report.reason,
          details: o.report.details ?? '',
          byRole: o.report.byRole,
          createdAt: o.report.createdAt,
        }
      : null,
    dispute: {
      status: o.dispute?.status ?? 'none',
      resolution: o.dispute?.resolution ?? null,
      resolvedAt: o.dispute?.resolvedAt ?? null,
    },
    ...(admin && {
      trail: (o.trail ?? []).map((t) => [t.lat, t.lng]),
      events: (o.events ?? []).map((e) => ({
        type: e.type,
        from: e.from ?? null,
        to: e.to ?? null,
        byRole: e.byRole ?? null,
        note: e.note ?? null,
        amount: e.amount ?? null,
        at: e.at,
      })),
    }),
  };
}

/** ~550 m grid. Snapping (not random jitter) so repeated polling can't average it out. */
const APPROX_GRID_DEG = 0.005;
export const APPROX_RADIUS_M = 600;
const snap = (n) => +(Math.round(n / APPROX_GRID_DEG) * APPROX_GRID_DEG).toFixed(4);

/**
 * What a driver sees of an open request before accepting: the pickup's neighbourhood and
 * an approximate circle, no exact address, route line or passenger phone number.
 */
export function serializeOpenRequest(ride) {
  const v = serializeRide(ride);
  const p = v.pickupLocation;
  return {
    ...v,
    pickupLocation: {
      address: p.area ? `Near ${p.area}` : 'Exact pickup shown after you accept',
      area: p.area ?? null,
      lat: p.lat != null ? snap(p.lat) : null,
      lng: p.lng != null ? snap(p.lng) : null,
      approximate: true,
      radiusM: APPROX_RADIUS_M,
    },
    route: null,
    passenger: v.passenger && { ...v.passenger, phone: null },
  };
}
