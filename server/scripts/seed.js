/**
 * Seeds demo data for the admin dashboard: drivers (some online, some awaiting
 * verification), passengers, and a few days of rides including cancellations,
 * reports and a refund.
 *
 *   npm run seed         replace demo data
 *   npm run seed:clear   remove demo data only
 *
 * Only touches users with isDemo: true (emails @demo.boltmoto.test) and their rides.
 */
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { CITY_CENTER, estimateFare } from '../src/services/fare.js';
import { REPORT_REASONS, Ride } from '../src/models/Ride.js';
import { User } from '../src/models/User.js';

const DOMAIN = 'demo.boltmoto.test';
const clearOnly = process.argv.includes('--clear');

const PLACES = [
  'Kenyatta Avenue', 'Westlands Mall', 'Yaya Centre', 'Kilimani Road', 'Upper Hill', 'Ngong Road',
  'Lavington Green', 'Parklands Avenue', 'Gigiri Square', 'Hurlingham', 'Riverside Drive', 'Moi Avenue',
  'Kileleshwa', 'South C', 'Valley Arcade', 'Junction Mall', 'Museum Hill', 'Railways Station',
];

const DRIVERS = [
  { name: 'Juma Otieno', plate: 'KMDA 214B', make: 'Honda', model: 'Ace 125', docs: ['approved', 'approved'], online: true },
  { name: 'Brian Kiprop', plate: 'KMEB 882C', make: 'Bajaj', model: 'Boxer 150', docs: ['approved', 'approved'], online: true },
  { name: 'Peter Mwangi', plate: 'KMFC 019A', make: 'TVS', model: 'HLX 125', docs: ['approved', 'approved'], online: true },
  { name: 'Faith Achieng', plate: 'KMGD 450D', make: 'Honda', model: 'CB 125', docs: ['approved', 'approved'], online: true },
  { name: 'Samuel Njoroge', plate: 'KMHE 733E', make: 'Bajaj', model: 'Boxer 150', docs: ['approved', 'approved'], online: false },
  { name: 'Kevin Ouma', plate: 'KMJF 128F', make: 'TVS', model: 'Star 100', docs: ['pending', 'pending'], online: false },
  { name: 'Moses Kamau', plate: 'KMKG 905G', make: 'Haojue', model: 'DK 150', docs: ['approved', 'pending'], online: false },
  { name: 'Daniel Mutua', plate: 'KMLH 377H', make: 'Honda', model: 'Ace 125', docs: ['rejected', 'approved'], online: false },
];

const PASSENGERS = [
  'Amina Wanjiru', 'Grace Njeri', 'Lucy Akinyi', 'David Kariuki', 'Mercy Chebet',
  'John Odhiambo', 'Esther Wambui', 'Ali Hassan', 'Sarah Muthoni', 'Tom Barasa',
];

const pick = (arr, i) => arr[i % arr.length];
const slug = (name) => name.toLowerCase().replace(/[^a-z]+/g, '.');
const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
const jitter = () => (Math.random() - 0.5) * 0.06;

async function clearDemo() {
  const ids = (await User.find({ isDemo: true }).select('_id').lean()).map((u) => u._id);
  const rides = await Ride.deleteMany({ $or: [{ passengerId: { $in: ids } }, { driverId: { $in: ids } }] });
  const users = await User.deleteMany({ _id: { $in: ids } });
  console.log(`Removed ${users.deletedCount} demo users and ${rides.deletedCount} rides`);
}

function doc(status, file, daysAgo) {
  if (status === 'missing') return {};
  return {
    status,
    fileName: file,
    fileSize: 180_000 + Math.round(Math.random() * 900_000),
    uploadedAt: minutesAgo(daysAgo * 1440 + 30),
    ...(status !== 'pending' && { reviewedAt: minutesAgo(daysAgo * 1440), note: status === 'rejected' ? 'Photo is blurry, please re-upload' : undefined }),
  };
}

async function seed() {
  const drivers = await User.insertMany(
    DRIVERS.map((d, i) => ({
      name: d.name,
      email: `${slug(d.name)}@${DOMAIN}`,
      role: 'driver',
      phone: `+254 7${String(10_000_000 + i * 1_234_567).slice(0, 8)}`,
      isDemo: true,
      isOnline: d.online,
      vehicle: { make: d.make, model: d.model, plate: d.plate },
      documents: {
        license: doc(d.docs[0], `license_${slug(d.name)}.jpg`, 3 + i),
        insurance: doc(d.docs[1], `insurance_${slug(d.name)}.pdf`, 3 + i),
      },
      location: d.online
        ? { lat: CITY_CENTER.lat + jitter(), lng: CITY_CENTER.lng + jitter(), simulated: true, updatedAt: new Date() }
        : undefined,
      createdAt: minutesAgo((20 - i) * 1440),
    })),
  );

  const passengers = await User.insertMany(
    PASSENGERS.map((name, i) => ({
      name,
      email: `${slug(name)}@${DOMAIN}`,
      role: 'passenger',
      phone: `+254 72${String(1_000_000 + i * 734_521).slice(0, 7)}`,
      isDemo: true,
      createdAt: minutesAgo((i < 2 ? 2 * 60 : (15 - i) * 1440)),
      ...(i === 9 && { status: 'banned', bannedAt: minutesAgo(600), banReason: 'Repeated no-shows and abusive messages' }),
    })),
  );

  const verified = drivers.filter((_, i) => DRIVERS[i].docs.every((s) => s === 'approved'));
  const rides = [];

  // Spread rides over the last 3 days: mostly completed, some cancelled.
  for (let i = 0; i < 46; i++) {
    const created = minutesAgo(15 + i * 95 + Math.round(Math.random() * 40));
    const pickup = pick(PLACES, i * 7 + 3);
    let dropoff = pick(PLACES, i * 5 + 11);
    if (dropoff === pickup) dropoff = pick(PLACES, i + 1);
    const quote = await estimateFare(pickup, dropoff);
    const passenger = pick(passengers.slice(0, 9), i);
    const driver = pick(verified, i);
    const cancelled = i % 6 === 4;
    const cancelledEarly = cancelled && i % 12 === 4;
    const t = (m) => new Date(created.getTime() + m * 60_000);

    const ride = {
      passengerId: passenger._id,
      pickupLocation: quote.pickup,
      dropoffLocation: quote.dropoff,
      fare: quote.fare,
      currency: quote.currency,
      distanceKm: quote.distanceKm,
      durationMin: quote.durationMin,
      surgeMultiplier: 1 + (i % 5 === 0 ? 0.2 : 0),
      createdAt: created,
      events: [{ type: 'status', to: 'requested', byRole: 'passenger', by: passenger._id, at: created }],
    };
    if (cancelledEarly) {
      Object.assign(ride, { status: 'cancelled', cancelledAt: t(3), cancelledBy: 'passenger' });
      ride.events.push({ type: 'status', from: 'requested', to: 'cancelled', byRole: 'passenger', by: passenger._id, at: t(3) });
    } else if (cancelled) {
      Object.assign(ride, { status: 'cancelled', driverId: driver._id, acceptedAt: t(1), cancelledAt: t(9), cancelledBy: 'driver' });
      ride.events.push(
        { type: 'status', from: 'requested', to: 'accepted', byRole: 'driver', by: driver._id, at: t(1) },
        { type: 'status', from: 'accepted', to: 'cancelled', byRole: 'driver', by: driver._id, at: t(9) },
      );
    } else {
      const done = t(4 + quote.durationMin);
      Object.assign(ride, { status: 'completed', driverId: driver._id, acceptedAt: t(1), startedAt: t(4), completedAt: done });
      ride.events.push(
        { type: 'status', from: 'requested', to: 'accepted', byRole: 'driver', by: driver._id, at: t(1) },
        { type: 'status', from: 'accepted', to: 'ongoing', byRole: 'driver', by: driver._id, at: t(4) },
        { type: 'status', from: 'ongoing', to: 'completed', byRole: 'driver', by: driver._id, at: done },
      );
    }
    rides.push(ride);
  }

  // Reports: two open, one resolved with a partial refund.
  const report = (ride, reason, details, at) => {
    ride.report = { by: ride.passengerId, byRole: 'passenger', reason, details, createdAt: at };
    ride.dispute = { status: 'open' };
    ride.events.push({ type: 'report', byRole: 'passenger', by: ride.passengerId, note: REPORT_REASONS[reason], at });
  };
  const completed = rides.filter((r) => r.status === 'completed');
  const driverCancelled = rides.filter((r) => r.cancelledBy === 'driver');

  report(completed[1], 'overcharged', 'The app quoted much less than I was charged. The rider took a long detour through Ngong Road.', minutesAgo(40));
  report(driverCancelled[0], 'no_show', 'Driver accepted, then cancelled after I waited 10 minutes at the pickup.', minutesAgo(70));
  const refunded = completed[4];
  report(refunded, 'route', 'Route was much longer than needed.', minutesAgo(1500));
  const refund = Math.round(refunded.fare * 0.3 * 100) / 100;
  refunded.refundedAmount = refund;
  refunded.dispute = { status: 'resolved', resolution: 'Confirmed detour on GPS trace. Refunded 30%.', resolvedAt: minutesAgo(1400) };
  refunded.events.push(
    { type: 'refund', amount: refund, byRole: 'admin', note: 'Detour confirmed', at: minutesAgo(1401) },
    { type: 'resolve', byRole: 'admin', note: 'Confirmed detour on GPS trace. Refunded 30%.', at: minutesAgo(1400) },
  );

  // Two trips in progress right now on online drivers, plus one waiting request.
  const online = drivers.filter((_, i) => DRIVERS[i].online);
  const live = [
    { driver: online[0], status: 'ongoing', p: passengers[0] },
    { driver: online[1], status: 'accepted', p: passengers[1] },
    { driver: null, status: 'requested', p: passengers[2] },
  ];
  for (const [i, l] of live.entries()) {
    const quote = await estimateFare(pick(PLACES, i + 2), pick(PLACES, i + 9));
    const created = minutesAgo(6 - i);
    rides.push({
      passengerId: l.p._id,
      driverId: l.driver?._id ?? null,
      pickupLocation: quote.pickup,
      dropoffLocation: quote.dropoff,
      fare: quote.fare,
      currency: quote.currency,
      distanceKm: quote.distanceKm,
      durationMin: quote.durationMin,
      surgeMultiplier: quote.surgeMultiplier,
      status: l.status,
      createdAt: created,
      ...(l.driver && { acceptedAt: minutesAgo(5 - i) }),
      ...(l.status === 'ongoing' && { startedAt: minutesAgo(3) }),
      events: [{ type: 'status', to: 'requested', byRole: 'passenger', by: l.p._id, at: created }],
    });
  }

  await Ride.insertMany(rides, { timestamps: false });
  console.log(`Seeded ${drivers.length} drivers, ${passengers.length} passengers and ${rides.length} rides`);
}

await connectDB();
await clearDemo();
if (!clearOnly) await seed();
await mongoose.disconnect();
