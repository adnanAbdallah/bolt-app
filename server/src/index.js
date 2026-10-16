import http from 'node:http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import passport from './config/passport.js';
import authRoutes from './routes/auth.js';
import rideRoutes from './routes/rides.js';
import driverRoutes from './routes/drivers.js';
import adminRoutes from './routes/admin.js';
import geoRoutes from './routes/geo.js';
import { errorHandler, notFound } from './middleware/error.js';
import { initRealtime } from './services/realtime.js';
import { startDemoFleet } from './services/demoFleet.js';
import { User } from './models/User.js';

const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(passport.initialize());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/geo', geoRoutes);

app.use('/api', notFound);
app.use(errorHandler);

await connectDB();

// One-time backfill for accounts created before account statuses existed (Level 1).
const { modifiedCount } = await User.updateMany({ status: { $exists: false } }, { $set: { status: 'active' } });
if (modifiedCount) console.log(`Backfilled status on ${modifiedCount} existing user(s)`);

const server = http.createServer(app);
initRealtime(server);
server.listen(env.port, () => {
  console.log(`API + realtime listening on ${env.serverUrl} (location mode: ${env.locationMode})`);
  if (env.simulateDemoFleet) startDemoFleet();
});
