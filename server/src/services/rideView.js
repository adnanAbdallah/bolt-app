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

/** `admin: true` adds contact details and the full audit trail. */
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
