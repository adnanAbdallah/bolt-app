import { Router } from 'express';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { Ride } from '../models/Ride.js';
import { DOCUMENT_TYPES } from '../models/User.js';
import {
  broadcastFleetRemove,
  broadcastFleetUpdate,
  emitStatsChanged,
  updateDriverLocation,
} from '../services/realtime.js';

const router = Router();
router.use(requireAuth, requireRole('driver'));

router.patch(
  '/status',
  asyncHandler(async (req, res) => {
    const { isOnline } = req.body ?? {};
    if (typeof isOnline !== 'boolean') throw new HttpError(400, 'isOnline must be a boolean');

    if (isOnline && env.requireDriverVerification && !req.user.isVerifiedDriver()) {
      throw new HttpError(403, 'Your license and insurance must be approved before you can go online');
    }
    if (!isOnline) {
      const busy = await Ride.exists({ driverId: req.user._id, status: { $in: ['accepted', 'ongoing'] } });
      if (busy) throw new HttpError(409, 'Finish your current ride before going offline');
    }

    req.user.isOnline = isOnline;
    await req.user.save();
    res.json({ user: req.user.toPublicJSON() });

    if (isOnline) broadcastFleetUpdate(req.user).catch(console.error);
    else broadcastFleetRemove(req.user._id);
    emitStatsChanged();
  }),
);

/** HTTP fallback for location updates (the socket `driver:location` event is preferred). */
router.post(
  '/location',
  asyncHandler(async (req, res) => {
    const result = await updateDriverLocation(req.user._id, req.body ?? {});
    res.status(result.ok ? 200 : 422).json(result);
  }),
);

/** Mock document upload: records file metadata and puts the document in the review queue. */
router.post(
  '/documents/:type',
  asyncHandler(async (req, res) => {
    const { type } = req.params;
    if (!DOCUMENT_TYPES.includes(type)) throw new HttpError(400, `Unknown document type: ${type}`);
    const { fileName, fileSize } = req.body ?? {};
    if (typeof fileName !== 'string' || !fileName.trim()) throw new HttpError(400, 'fileName is required');
    if (fileSize !== undefined && (typeof fileSize !== 'number' || fileSize < 0 || fileSize > 10 * 1024 * 1024)) {
      throw new HttpError(400, 'Files must be 10 MB or smaller');
    }
    if (req.user.documents?.[type]?.status === 'approved') {
      throw new HttpError(409, 'This document is already approved');
    }

    req.user.set(`documents.${type}`, {
      status: 'pending',
      fileName: fileName.trim().slice(0, 120),
      fileSize,
      uploadedAt: new Date(),
    });
    await req.user.save();
    res.json({ user: req.user.toPublicJSON() });
    emitStatsChanged();
  }),
);

export default router;
