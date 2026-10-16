import mongoose from 'mongoose';

export const ROLES = ['passenger', 'driver', 'admin'];
/** Roles a user may pick for themselves at sign-up. Admin is granted via ADMIN_EMAILS only. */
export const SELF_ASSIGNABLE_ROLES = ['passenger', 'driver'];

export const ACCOUNT_STATUSES = ['active', 'banned'];
export const DOCUMENT_TYPES = ['license', 'insurance'];
export const DOCUMENT_STATUSES = ['missing', 'pending', 'approved', 'rejected'];

// Mock upload: we keep the file's metadata and review state, not the file itself.
const documentSchema = new mongoose.Schema(
  {
    status: { type: String, enum: DOCUMENT_STATUSES, default: 'missing' },
    fileName: String,
    fileSize: Number,
    uploadedAt: Date,
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String,
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    googleId: { type: String, unique: true, sparse: true },
    role: { type: String, enum: ROLES, default: 'passenger', index: true },
    phone: { type: String, trim: true },
    avatar: { type: String },

    status: { type: String, enum: ACCOUNT_STATUSES, default: 'active', index: true },
    bannedAt: Date,
    banReason: String,

    // Driver-only fields
    isOnline: { type: Boolean, default: false, index: true },
    vehicle: {
      make: String,
      model: String,
      plate: String,
    },
    documents: {
      license: { type: documentSchema, default: () => ({}) },
      insurance: { type: documentSchema, default: () => ({}) },
    },
    location: {
      lat: Number,
      lng: Number,
      heading: Number,
      accuracy: Number,
      simulated: Boolean,
      updatedAt: Date,
    },
    // Seeded demo drivers that the dev fleet simulator moves around.
    isDemo: { type: Boolean, default: false },

    lastLoginAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

/** A driver may go online only when every required document is approved. */
userSchema.methods.isVerifiedDriver = function isVerifiedDriver() {
  return DOCUMENT_TYPES.every((t) => this.documents?.[t]?.status === 'approved');
};

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    status: this.status,
    phone: this.phone ?? null,
    avatar: this.avatar ?? null,
    ...(this.role === 'driver' && {
      isOnline: this.isOnline,
      vehicle: this.vehicle ?? null,
      documents: serializeDocuments(this.documents),
      verified: this.isVerifiedDriver(),
      // The driver's own last position (lets the dev simulator resume where it stopped).
      location: this.location?.lat != null ? { lat: this.location.lat, lng: this.location.lng, heading: this.location.heading ?? null } : null,
    }),
  };
};

export function serializeDocuments(documents) {
  return Object.fromEntries(
    DOCUMENT_TYPES.map((t) => {
      const d = documents?.[t] ?? {};
      return [
        t,
        {
          status: d.status ?? 'missing',
          fileName: d.fileName ?? null,
          fileSize: d.fileSize ?? null,
          uploadedAt: d.uploadedAt ?? null,
          reviewedAt: d.reviewedAt ?? null,
          note: d.note ?? null,
        },
      ];
    }),
  );
}

export const User = mongoose.model('User', userSchema);
