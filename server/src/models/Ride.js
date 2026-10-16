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

    acceptedAt: Date,
    startedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancelledBy: { type: String, enum: ['passenger', 'driver', 'admin'] },
  },
  { timestamps: true },
);

rideSchema.index({ status: 1, createdAt: 1 });

export const Ride = mongoose.model('Ride', rideSchema);
