import mongoose from 'mongoose';

export const ROLES = ['passenger', 'driver', 'admin'];
/** Roles a user may pick for themselves at sign-up. Admin is granted via ADMIN_EMAILS only. */
export const SELF_ASSIGNABLE_ROLES = ['passenger', 'driver'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    googleId: { type: String, unique: true, sparse: true },
    role: { type: String, enum: ROLES, default: 'passenger', index: true },
    phone: { type: String, trim: true },
    avatar: { type: String },

    // Driver-only fields
    isOnline: { type: Boolean, default: false },
    vehicle: {
      make: String,
      model: String,
      plate: String,
    },

    lastLoginAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    phone: this.phone ?? null,
    avatar: this.avatar ?? null,
    ...(this.role === 'driver' && { isOnline: this.isOnline, vehicle: this.vehicle ?? null }),
  };
};

export const User = mongoose.model('User', userSchema);
