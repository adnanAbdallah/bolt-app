import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { Ride } from '../models/Ride.js';

const router = Router();
router.use(requireAuth, requireRole('driver'));

router.patch(
  '/status',
  asyncHandler(async (req, res) => {
    const { isOnline } = req.body ?? {};
    if (typeof isOnline !== 'boolean') throw new HttpError(400, 'isOnline must be a boolean');

    if (!isOnline) {
      const busy = await Ride.exists({ driverId: req.user._id, status: { $in: ['accepted', 'ongoing'] } });
      if (busy) throw new HttpError(409, 'Finish your current ride before going offline');
    }

    req.user.isOnline = isOnline;
    await req.user.save();
    res.json({ user: req.user.toPublicJSON() });
  }),
);

export default router;
