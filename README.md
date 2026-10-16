# Bolt Moto — Level 1 MVP

Motorcycle ride-hailing app: Google sign-in, passenger booking with dynamic fares, and a driver dashboard that moves rides through `requested → accepted → ongoing → completed`.

## Structure

```
server/                      Express + Mongoose API (port 5000)
  src/
    index.js                 App bootstrap, middleware, route mounting
    config/
      env.js                 Typed env config
      db.js                  MongoDB connection
      passport.js            Google OAuth strategy + user upsert
    models/
      User.js                name, email, role, phone, avatar, isOnline, vehicle
      Ride.js                passengerId, driverId, locations, status, fare + TRANSITIONS table
    middleware/
      auth.js                requireAuth (JWT cookie) / requireRole
      error.js               asyncHandler, HttpError, error handler
    routes/
      auth.js                /api/auth/*  (Google OAuth, me, logout, dev-login)
      rides.js               /api/rides/* (estimate, request, accept, start, complete, cancel)
      drivers.js             /api/drivers/status (online toggle)
    services/
      token.js               JWT + cookie helpers, signed OAuth state
      fare.js                Mock geocoding + dynamic (surge) pricing
client/                      Vite + React + Tailwind v4 + Lucide (port 5173)
  src/
    App.jsx                  Routes + role-based redirects
    context/AuthContext.jsx  Session state (GET /api/auth/me)
    lib/api.js               Fetch wrapper for every endpoint
    lib/usePolling.js        Visibility-aware polling hook
    components/              Layout, ProtectedRoute, RideProgress, RouteSummary, …
    pages/
      Login.jsx              Role picker + Google button (+ dev login)
      PassengerHome.jsx      Booking form, live fare quote, active-ride tracker
      DriverDashboard.jsx    Online toggle, incoming requests, current trip, earnings
      AdminHome.jsx          Recent rides table
```

## Running locally

Requires Node 20+ and MongoDB on `mongodb://127.0.0.1:27017`.

```bash
# Terminal 1 — API
cd server
npm install
cp .env.example .env    # then set JWT_SECRET and Google credentials
npm run dev

# Terminal 2 — client
cd client
npm install
npm run dev             # http://localhost:5173
```

In development, Vite proxies `/api` to `localhost:5000`, so the auth cookie is same-origin.

### Google OAuth setup

1. Open Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** (Web application).
2. Authorized redirect URI: `http://localhost:5000/api/auth/google/callback`
3. Put the client ID and secret into `server/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Testing without Google

With `ENABLE_DEV_LOGIN=true` (ignored when `NODE_ENV=production`), the login screen shows a **Dev login** box that signs you in by email. To test both sides at once, use one normal window as the passenger and one private window as the driver, because the session cookie is shared within a browser profile.

## How it works

**Auth.** `/api/auth/google?role=driver` sends the chosen role through a signed, short-lived OAuth `state`. On the callback, the user is found or created and a 7-day JWT is set as an `httpOnly` cookie. The browser is then redirected by role: passengers to `/ride`, drivers to `/driver`, admins to `/admin`. The role is fixed at first sign-in. Users cannot choose `admin`; it is granted only to emails listed in `ADMIN_EMAILS`.

**Fares.** `services/fare.js` maps each address to stable mock coordinates, then computes distance and duration. The fare is `base + perKm·km + perMin·min`, multiplied by a surge factor. Surge depends on open requests per online driver (1.0×–2.0×) plus a 1.2× peak-hour bump, capped at 2.5×. The server always recalculates the fare when a ride is requested and ignores any fare the client sends.

**State transitions.** These are defined once in `Ride.TRANSITIONS`. Each transition is a single atomic `findOneAndUpdate` filtered on the current status, so two drivers cannot both accept the same ride.

| Action   | Who                | From → To                          |
|----------|--------------------|------------------------------------|
| request  | passenger          | — → requested                      |
| accept   | online driver      | requested → accepted               |
| start    | assigned driver    | accepted → ongoing                 |
| complete | assigned driver    | ongoing → completed                |
| cancel   | passenger          | requested/accepted → cancelled     |
| cancel   | assigned driver    | accepted → cancelled               |

Other rules: a passenger can have only one active ride, a driver can have only one current trip, and a driver cannot go offline in the middle of a trip.

**Realtime.** For Level 1, both clients poll every 4 seconds while the tab is visible. Socket.IO is the natural upgrade path.

## API

| Method | Path                         | Auth            |
|--------|------------------------------|-----------------|
| GET    | `/api/auth/google?role=`     | —               |
| GET    | `/api/auth/google/callback`  | —               |
| GET    | `/api/auth/me`               | any             |
| PATCH  | `/api/auth/me`               | any (phone, name, vehicle) |
| POST   | `/api/auth/logout`           | —               |
| POST   | `/api/rides/estimate`        | any             |
| POST   | `/api/rides`                 | passenger       |
| GET    | `/api/rides/active`          | any             |
| GET    | `/api/rides/history`         | any (admin: all)|
| GET    | `/api/rides/available`       | driver          |
| POST   | `/api/rides/:id/accept`      | driver          |
| POST   | `/api/rides/:id/start`       | driver          |
| POST   | `/api/rides/:id/complete`    | driver          |
| POST   | `/api/rides/:id/cancel`      | passenger/driver/admin |
| PATCH  | `/api/drivers/status`        | driver          |
