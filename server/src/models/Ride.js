import mongoose from 'mongoose';

export const RIDE_STATUSES = ['requested', 'accepted', 'ongoing', 'completed', 'cancelled'];
export const ACTIVE_STATUSES = ['requested', 'accepted', 'ongoing'];

/** Allowed status transitions. Anything not listed here is rejected. */
export const TRANSITIONS = {
  requested: ['accepted', 'cancelled'],
  accepted: ['ongoing', 'cancelled'],
  ongoing: ['completed'],
  completed: [],
  cancelled: [],
};

/** Statuses an admin may force a ride into, from any other status (dispute resolution). */
export const OVERRIDE_STATUSES = ['completed', 'cancelled'];

export const REPORT_REASONS = {
  overcharged: 'Overcharged',
  driver_behavior: 'Driver behaviour',
  passenger_behavior: 'Passenger behaviour',
  safety: 'Safety concern',
  route: 'Wrong or long route',
  no_show: 'No-show',
  other: 'Other',
};

export const canTransition = (from, to) => TRANSITIONS[from]?.includes(to) ?? false;

const locationSchema = new mongoose.Schema(
  {
    address: { type: String, required: true, trim: true, maxlength: 200 },
    // Mock coordinates for Level 1; replace with geocoding later.
    lat: Number,
    lng: Number,
  },
  { _id: false },
);

const eventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true }, // status | report | refund | override | resolve
    from: String,
    to: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byRole: String,
    note: String,
    amount: Number,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const rideSchema = new mongoose.Schema(
  {
    passengerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    pickupLocation: { type: locationSchema, required: true },
    dropoffLocation: { type: locationSchema, required: true },
    status: { type: String, enum: RIDE_STATUSES, default: 'requested', index: true },

    fare: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD' },
    distanceKm: Number,
    durationMin: Number,
    surgeMultiplier: { type: Number, default: 1 },
    refundedAmount: { type: Number, default: 0, min: 0 },

    acceptedAt: Date,
    startedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancelledBy: { type: String, enum: ['passenger', 'driver', 'admin'] },

    report: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      byRole: String,
      reason: { type: String, enum: Object.keys(REPORT_REASONS) },
      details: { type: String, maxlength: 1000 },
      createdAt: Date,
    },
    dispute: {
      status: { type: String, enum: ['none', 'open', 'resolved'], default: 'none', index: true },
      resolution: { type: String, maxlength: 1000 },
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      resolvedAt: Date,
    },

    /** Append-only audit trail shown in the admin dispute view. */
    events: { type: [eventSchema], default: [] },
  },
  { timestamps: true },
);

rideSchema.index({ status: 1, createdAt: 1 });
rideSchema.index({ completedAt: 1 });

export const Ride = mongoose.model('Ride', rideSchema);
