# Bolt Moto

Motorcycle ride-hailing app.

- **Level 1:** Google sign-in, passenger booking with dynamic fares, and a driver dashboard that moves rides through `requested → accepted → ongoing → completed`.
- **Level 2:** an admin dashboard (analytics, user and driver management with document verification, a live fleet map, dispute resolution) and real-time updates over Socket.IO.
- **Level 3:** real maps. Passengers search addresses or drop pins, see the road route, and watch their driver move toward them with a live ETA. Drivers get a map, navigation links, and either a dev route stepper (development) or real GPS tracking (production). Admins see trip routes and compare the planned route with the driver's actual trail.

## Structure

```
server/                      Express + Mongoose API (port 5001)
  src/
    index.js                 App bootstrap, routes, HTTP + Socket.IO server
    config/
      env.js                 Typed env config
      db.js                  MongoDB connection
      passport.js            Google OAuth strategy + user upsert
    models/
      User.js                name, email, role, status (active/banned), driver documents, location
      Ride.js                status + TRANSITIONS, fare, refunds, report, dispute, event timeline
    middleware/
      auth.js                requireAuth (JWT cookie, blocks banned users), requireRole, requireAdmin
      error.js               asyncHandler, HttpError, error handler
    routes/
      auth.js                /api/auth/*  (Google OAuth, me, logout, dev-login)
      rides.js               /api/rides/* (estimate, request, accept, start, complete, cancel, report)
      drivers.js             /api/drivers/* (online toggle, document upload, location)
      admin.js               /api/admin/* (stats, users, verification, fleet, trips, disputes)
      geo.js                 /api/geo/* (search, reverse, route)
    services/
      token.js               JWT + cookie helpers, signed OAuth state
      fare.js                Mock geocoding + dynamic (surge) pricing
      realtime.js            Socket.IO server: auth, rooms, events
      rideView.js            Ride JSON shape shared by API and sockets
      demoFleet.js           Dev-only simulator: demo drivers ride real roads
      geo.js                 Address search + reverse geocoding (Photon), offline fallback
      routing.js             Road routes (OSRM), straight-line fallback
    lib/
      geometry.js            Distances, bearings, points along a route (shared with client)
      throttle.js            1 req/s queue + cache for public map services, per-user limits
  scripts/seed.js            Demo data for the admin dashboard
client/                      Vite + React + Tailwind v4 + Lucide (port 5173)
  src/
    App.jsx                  Routes + role-based redirects
    context/AuthContext.jsx  Session state (GET /api/auth/me)
    context/SocketContext.jsx One Socket.IO connection per user + useSocketEvent hook
    lib/api.js               Fetch wrapper for every endpoint
    lib/usePolling.js        Fallback polling (sockets carry live updates)
    lib/useDriverLocation.js Driver position: dev route stepper or real GPS, ETA, arrival
    lib/geometry.js          Same helpers as the server (keep in sync)
    lib/appConfig.js         Server settings (location mode, map tiles, map centre)
    components/map/          Shared <Map> (Leaflet, lazy-loaded) and marker HTML
    components/PlaceInput.jsx Address autocomplete
    components/              Layout, ProtectedRoute, RideProgress, ReportProblem, DriverDocuments, …
    components/admin/        AdminLayout (sidebar), FleetMap (Leaflet), RideDialogs, ui kit
    pages/
      Login.jsx              Role picker + Google button (+ dev login)
      PassengerHome.jsx      Address search + map booking, fare, live driver tracking + ETA
      DriverDashboard.jsx    Map, dev stepper or GPS, requests, current trip, navigation
      admin/                 Overview, Fleet, Users, Trips, Disputes (lazy-loaded)
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

In development, Vite proxies `/api` and the `/socket.io` WebSocket to `localhost:5001`, so the auth cookie is same-origin. If the API runs on another port, start the client with `API_PROXY=http://localhost:PORT npm run dev`.

### Demo data for the admin dashboard

```bash
cd server
npm run seed          # 8 demo drivers (4 online), 10 passengers, ~50 rides, reports and a refund
npm run seed:clear    # remove demo data only
```

Demo users have emails ending in `@demo.boltmoto.test`. The seed only removes and recreates those users and their rides, so your real accounts are never touched. With `SIMULATE_DEMO_FLEET=true`, online demo drivers move around the Live fleet map every 3 seconds. You can also sign in as a demo user with Dev login:

| Email | What you get |
|---|---|
| `samuel.njoroge@demo.boltmoto.test` | Verified driver, offline, free to go online and accept rides |
| `juma.otieno@demo.boltmoto.test` | Verified driver who is in the middle of a trip |
| `kevin.ouma@demo.boltmoto.test` | Driver whose documents are waiting for admin review |
| `amina.wanjiru@demo.boltmoto.test` | Passenger with a trip in progress |

### Upgrading from Level 1

1. Install the new packages: run `npm install` in both `server/` and `client/`. The new packages are `socket.io`, `socket.io-client` and `leaflet`.
2. Add the new settings to `server/.env` (see [Configuration](#configuration)), then restart both servers.
3. Drivers created before Level 2 have no approved documents, so they **can't go online** until an admin approves them. Either open **Users & drivers → Documents** in the admin dashboard, or set `REQUIRE_DRIVER_VERIFICATION=false` while testing.
4. Existing rides and users need no migration. New fields get defaults the first time they are saved.

### Upgrading from Level 2

1. No new packages are needed.
2. Add the map settings to `server/.env` (see [Configuration](#configuration)). Every one has a working default, so this is optional for local testing. Set `MAP_CENTER` to your city if you are not testing around Nairobi.
3. Restart both servers.
4. Rides created before Level 3 have no stored route or trail. Maps draw them with straight lines, and the dispute view says "No GPS trail was recorded". Re-run `npm run seed` to get demo rides with routes and trails.

### Google sign-in setup

This sets up "Sign in with Google", which works with any Gmail account. You don't need to enable the Gmail API or any other API. You create OAuth credentials in Google Cloud and paste them into `server/.env`. It takes about 10 minutes.

#### 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com> and sign in with your Gmail account. Accept the terms of service if this is your first visit.
2. Click the project picker at the top left, then **New project**.
   - Project name: `Bolt Moto`
   - Location: leave it as **No organization**.
   - Click **Create**, then make sure **Bolt Moto** is selected in the project picker.

#### 2. Set up the consent screen

This is the screen people see when they click "Continue with Google".

3. Search for **Google Auth Platform** in the top search bar and open it. You can also go to **Menu → APIs & Services → OAuth consent screen**.
4. Click **Get started** and fill in the form:
   - **App information:** app name `Bolt Moto`; choose your Gmail address as the user support email.
   - **Audience:** **External**, so any Gmail account can sign in.
   - **Contact information:** your Gmail address.
   - **Finish:** accept the policy, then click **Continue** and **Create**.
5. Open **Audience** in the left menu. The app starts in **Testing** mode, where only listed accounts can sign in. Under **Test users**, click **Add users**, add every Gmail account you will test with (up to 100), and click **Save**.

You don't need to add scopes. The app asks only for basic profile and email, which Google allows by default.

#### 3. Create the OAuth client

6. Open **Clients** in the left menu and click **Create client**.
7. Fill in:
   - **Application type:** Web application
   - **Name:** `Bolt Moto local`
   - **Authorized JavaScript origins:** `http://localhost:5173`
   - **Authorized redirect URIs:** `http://localhost:5001/api/auth/google/callback` (exact match, no trailing slash)
8. Click **Create**. Copy the **Client ID** and **Client secret** right away, or click **Download JSON**. Google may not show the secret again. If you lose it, add a new secret to the same client.

#### 4. Add the keys to the project

9. In `server/.env`, set (no quotes, no spaces):

   ```env
   GOOGLE_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
   ```

10. Optional: to make an account an admin, add its email:

    ```env
    ADMIN_EMAILS=you@gmail.com
    ```

11. Restart the API (`Ctrl+C`, then `npm run dev` in `server/`). The `Google OAuth is not configured` warning should no longer appear in the log.

#### 5. Test it

12. Open <http://localhost:5173>, choose **Ride** or **Drive**, and click **Continue with Google**.
13. Pick your Gmail account. In testing mode Google shows **"Google hasn't verified this app"**. Click **Continue**. This is expected for your own test app.
14. You are sent back to the app: passengers land on `/ride`, drivers on `/driver`, and emails in `ADMIN_EMAILS` on `/admin`.
15. Optional: check that the user was saved:

    ```bash
    mongosh bolt-moto --eval 'db.users.find({}, {name:1, email:1, role:1})'
    ```

An account's role is set the first time it signs in. Signing in later with the other button does not change it. To test both sides at once, sign in with one Gmail account as **Ride** in a normal window and a different one as **Drive** in a private window. Both accounts must be test users.

#### Troubleshooting Google sign-in

| Error | Fix |
|---|---|
| `Error 400: redirect_uri_mismatch` | The redirect URI in Google must be exactly `http://localhost:5001/api/auth/google/callback`. Check http vs https, the port, and that there is no trailing slash. |
| `Error 403: access_denied` | The Gmail account isn't a test user. Add it under **Audience → Test users**. |
| `invalid_client` | The client ID or secret is wrong. Check `.env` for extra spaces or quotes, then restart the server. |
| Google button is greyed out | The server wasn't restarted after editing `.env`, or one of the two values is empty. |
| "Sign-in link expired" on the login page | More than 10 minutes passed on the Google screen. Click the button again. |
| A change in Google Cloud has no effect | Google settings can take up to 5 minutes to apply. Wait and retry. |

#### Going to production

1. In **Clients**, add your real origin (for example `https://yourdomain.com`) and redirect URI (for example `https://api.yourdomain.com/api/auth/google/callback`).
2. In `server/.env`, set `SERVER_URL` and `CLIENT_URL` to those addresses and set `NODE_ENV=production`. This turns off dev login and makes the auth cookie HTTPS-only.
3. In **Audience**, click **Publish app** so any Gmail account can sign in, not only test users. With only basic profile and email scopes, Google normally doesn't require a review.

### Opening the admin dashboard

Admin access is granted only by `ADMIN_EMAILS` in `server/.env`, never chosen at sign-in. Add your email there, restart the API, and sign in with that email, either with Google or with Dev login. You land on `/admin`. Any other role that opens `/admin` is sent to its own home page, and the API answers `403` to every `/api/admin/*` request from non-admins.

### What's in the admin dashboard

| Page | Path | What you can do |
|---|---|---|
| Overview | `/admin` | Rides today, drivers online, revenue today (each compared with yesterday), registered users, today's rides by status, a "needs attention" list, revenue totals, live trips |
| Live fleet | `/admin/fleet` | Map of every online driver, updated in real time. Marker color and icon show the driver's state: available, heading to pickup, on trip, or no signal for 2 minutes. Search by name or plate, and click a driver to find them on the map. A selected driver on a trip also shows their route and the pickup and dropoff |
| Users & drivers | `/admin/users` | Search and filter all accounts, review driver license and insurance (approve, or reject with a note), suspend with a reason, reactivate |
| Active trips | `/admin/trips` | Every ride that hasn't finished, grouped by status. Requests waiting over 5 minutes are highlighted. Force-complete or cancel a stuck ride |
| Disputes | `/admin/disputes` | Reported and cancelled rides. See the report, the full timeline, and a map comparing the planned route with the driver's actual trail (flagged when the trail is over 25% longer). Issue full or partial refunds, override the status, and resolve with a message to the passenger |

The sidebar shows live counts (drivers online, pending reviews, active trips, open disputes) and whether live updates are connected. On phones it collapses into a menu.

### Testing without Google

With `ENABLE_DEV_LOGIN=true` (ignored when `NODE_ENV=production`), the login screen shows a **Dev login** box that signs you in by email. To test both sides at once, use one normal window as the passenger and one private window as the driver, because the session cookie is shared within a browser profile.

## Configuration

All server settings live in `server/.env`. `server/.env.example` lists them with safe defaults. Never commit `.env`; it holds your secrets.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` turns off dev login and the demo fleet, and makes the auth cookie HTTPS-only |
| `PORT` | `5001` | API and WebSocket port |
| `MONGODB_URI` | — (required) | MongoDB connection string |
| `JWT_SECRET` | — (required) | Signs login cookies and Google sign-in state. Use a long random value |
| `JWT_EXPIRES_IN` | `7d` | How long a login lasts |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | empty | Google OAuth keys. While empty, the Google button is disabled |
| `SERVER_URL` | `http://localhost:5001` | Public API address, used for the Google callback URL |
| `CLIENT_URL` | `http://localhost:5173` | Where users land after sign-in, and the allowed CORS and WebSocket origin |
| `ADMIN_EMAILS` | empty | Comma-separated emails that get the admin role |
| `ENABLE_DEV_LOGIN` | `false` | `true` shows the email-only Dev login (never in production) |
| `REQUIRE_DRIVER_VERIFICATION` | `true` | Drivers need an approved license and insurance before going online |
| `SIMULATE_DEMO_FLEET` | `false` | `true` moves seeded demo drivers on the Live fleet map (never in production) |
| `LOCATION_MODE` | `simulated` in development, `gps` in production | `simulated`: drivers move along routes with the dev controls. `gps`: real device GPS only; the server rejects simulated positions |
| `MAP_CENTER` | `-1.2864,36.8172` | Default map view and demo city, as `lat,lng` |
| `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION` | OpenStreetMap | Map tiles. The public OSM tile server is for light development use; use your own or a provider in production |
| `GEOCODER` | `photon` | Address search: `photon` or `mock` (offline, made-up coordinates) |
| `GEOCODER_URL` | `https://photon.komoot.io` | Photon server |
| `ROUTING` | `osrm` | Road routes: `osrm` or `straight` (offline straight line × 1.3) |
| `ROUTING_URL` | `https://router.project-osrm.org` | OSRM server. The public demo server is for development only |
| `ROUTE_DURATION_FACTOR` | `1.5` | OSRM's car times assume empty roads; this scales them for city traffic (ETAs and the time part of fares) |
| `GEO_USER_AGENT` | `BoltMotoDev/0.1 (local development)` | Sent to the map services, as their usage policies require. Put your app name and contact in production |
| `FARE_CURRENCY` | `USD` | Currency code for fares, e.g. `KES` |
| `FARE_BASE`, `FARE_PER_KM`, `FARE_PER_MIN`, `FARE_MINIMUM` | `1.00`, `0.45`, `0.08`, `2.00` | Pricing inputs (see Fares below) |

Client: `API_PROXY` (default `http://localhost:5001`) changes where the Vite dev server forwards `/api` and `/socket.io`.

## How it works

**Auth.** `/api/auth/google?role=driver` sends the chosen role through a signed, short-lived OAuth `state`. On the callback, the user is found or created and a 7-day JWT is set as an `httpOnly` cookie. The browser is then redirected by role: passengers to `/ride`, drivers to `/driver`, admins to `/admin`. The role is fixed at first sign-in. Users cannot choose `admin`; it is granted only to emails listed in `ADMIN_EMAILS`.

**Fares.** The passenger picks places by address search or map pins. `services/routing.js` gets the road route, and its distance and duration price the trip. If the routing service is unreachable, a straight line × 1.3 is used instead. The fare is `base + perKm·km + perMin·min`, multiplied by a surge factor. Surge depends on open requests per online driver (1.0×–2.0×) plus a 1.2× peak-hour bump, capped at 2.5×. The server always recalculates the fare when a ride is requested and ignores any fare the client sends.

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

**Real time.** The API and Socket.IO share one server and one login cookie. Each signed-in browser opens one socket, which joins the rooms `user:<id>`, plus `drivers` or `admins` depending on its role. Ride changes, new requests, verification results and bans are pushed instantly. Passenger and driver screens also poll every 20 seconds as a safety net, and refetch when the socket reconnects.

| Event | Sent to | When |
|---|---|---|
| `ride:updated` | the ride's passenger and driver, and admins | any status change, report, refund, override or resolution |
| `rides:changed` | all drivers | the open request list changed |
| `ride:driver-location` | **only** the passenger of the driver's active ride | every accepted driver position while the ride is accepted or ongoing |
| `fleet:update` / `fleet:remove` | admins | a driver moved, went online or offline, or started or ended a trip |
| `stats:changed` | admins | dashboard numbers changed |
| `user:updated` | that user | a document was approved or rejected |
| `account:banned` | that user | the account was suspended (they are signed out) |
| `driver:location` (client → server, with acknowledgement) | — | an online driver's position. Accepted at most every 1.5 s in gps mode, 0.2 s in simulated mode. The reply is `{ ok }` or `{ ok: false, reason }` |

**Maps and routes.** Every map is one shared Leaflet component (`components/map/Map.jsx`), loaded only on screens that show a map. Address search goes through the server (`/api/geo/search`), which uses Photon. Nominatim is not used for search because its usage policy forbids type-ahead autocomplete. Requests to the public map services go through a 1 request/second queue with caching, and fall back to offline estimates if a service is down.

A ride stores three lines:

| Line | What it is | Who sees it |
|---|---|---|
| `route` | Planned pickup → dropoff road route; the fare is priced on it | Passenger, assigned driver, admins |
| `approachRoute` | Driver's position at accept time → pickup | Passenger, assigned driver, admins |
| `trail` | Breadcrumbs of where the driver actually went (every 50 m, up to 2,000 points) | Admins only (Disputes) |

**Privacy.** Before accepting, a driver sees the pickup only as "Near <neighbourhood>" and a 600 m circle, snapped to a grid so repeated requests can't narrow it down. They see no route line and no passenger phone number. The exact pickup appears after they accept. A passenger receives their driver's position only while their ride is accepted or ongoing.

**Driver location: development (`LOCATION_MODE=simulated`).** The driver dashboard shows a **Dev mode** panel. The driver moves along the actual road route:
- **Next** / **Back** move one step (50, 100 or 250 m).
- **Auto-play** moves at 15, 25 or 40 km/h.
- **Jump to pickup** / **Jump to dropoff** go straight to the end of the leg.
- A readout shows progress, for example "1.2 km of 3.4 km to pickup · ETA 6 min".

Within 50 m of the pickup or dropoff, an "Arrived" prompt offers **Start trip** or **Complete trip**. With no ride, the driver cruises along a route to a random nearby point. If a passenger books far from the simulated driver (for example in your real city while `MAP_CENTER` is Nairobi), accepting places the driver about 1.5 km from the pickup so the flow still works.

**Driver location: production (`LOCATION_MODE=gps`).** Only real device GPS is used, and the server rejects simulated positions:
- Before going online, the app asks for location permission. If it's denied, the driver can't go online and sees how to allow it.
- Fixes with accuracy worse than 100 m, or jumps implying more than 150 km/h, are ignored on the phone and on the server.
- Positions are sent every 3 s, or after 20 m of movement.
- With no fix for 30 s, the driver sees a warning, and the passenger and admin see "No recent signal".
- The screen is kept awake while the driver is online.

Two platform limits apply. Browsers allow geolocation only over **HTTPS**, and they pause GPS when the tab is in the background or the phone is locked. Real background tracking needs a native app or an installable PWA wrapper.

**Driver verification.** With `REQUIRE_DRIVER_VERIFICATION=true` (the default), a driver can go online only after an admin approves both their license and their insurance. Uploads are mocks: only the file name and size are stored. Rejecting a document requires a note, which the driver sees, and takes an online driver offline unless they are mid-trip.

**Suspending accounts.** Suspending (banning) a user:
- signs them out on every device immediately, through the socket and the next API call
- blocks future sign-ins
- takes a driver offline
- cancels their rides that haven't started yet. Trips already in progress are left for an admin to resolve.

Admins can't suspend themselves or other admins.

**Disputes, refunds and overrides.** Passengers can report a completed ride, or a ride a driver cancelled. Drivers can report through the API. A report opens a dispute. Admins can:
- **refund** part or all of a *completed* ride's fare. This is atomic: the total refunded can never exceed the fare, even with two refunds at once.
- **override** a ride's status to `completed` or `cancelled`, for example for a stuck trip.
- **resolve** the dispute with a message the passenger sees.

Every action is appended to the ride's `events` timeline, together with who did it.

**Revenue.** Revenue is completed fares minus refunds, counted on the day each ride was completed. Cancelled rides were never charged, so they can't be refunded.

## API

| Method | Path                         | Auth            |
|--------|------------------------------|-----------------|
| GET    | `/api/health`                | —               |
| GET    | `/api/auth/config`           | — (which sign-in options are on) |
| GET    | `/api/auth/google?role=`     | —               |
| GET    | `/api/auth/google/callback`  | —               |
| GET    | `/api/auth/me`               | any             |
| PATCH  | `/api/auth/me`               | any (phone, name, vehicle) |
| POST   | `/api/auth/dev-login`        | — (development only: `{ email, role }`) |
| POST   | `/api/auth/logout`           | —               |
| POST   | `/api/rides/estimate`        | any             |
| POST   | `/api/rides`                 | passenger       |
| GET    | `/api/rides/active`          | any             |
| GET    | `/api/rides/history`         | passenger/driver|
| GET    | `/api/rides/available`       | driver          |
| POST   | `/api/rides/:id/accept`      | driver          |
| POST   | `/api/rides/:id/start`       | driver          |
| POST   | `/api/rides/:id/complete`    | driver          |
| POST   | `/api/rides/:id/cancel`      | passenger/driver |
| GET    | `/api/rides/report-reasons`  | any             |
| POST   | `/api/rides/:id/report`      | passenger/driver of that ride |
| PATCH  | `/api/drivers/status`        | driver (verified) |
| POST   | `/api/drivers/documents/:type` | driver (`license` or `insurance`) |
| POST   | `/api/drivers/location`      | driver (HTTP fallback for the socket event; `422` with a reason if rejected) |
| GET    | `/api/geo/search?q=&lat=&lng=` | signed in (address autocomplete, 3+ characters) |
| GET    | `/api/geo/reverse?lat=&lng=` | signed in (address for a map pin) |
| GET    | `/api/geo/route?from=lat,lng&to=lat,lng` | signed in (road route) |

`/api/geo/*` allows 15 requests per 10 s per user. `POST /api/rides/estimate` and `POST /api/rides` take `pickup` and `dropoff` as `{ address, lat, lng }`. A plain address string is still accepted and mapped to made-up coordinates.

### Admin API (all require role `admin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/admin/stats` | Rides today vs yesterday, drivers online, revenue (today, yesterday, all time), user counts, pending verifications, open disputes |
| GET    | `/api/admin/users?role=&status=&q=&verification=pending&page=` | Users and drivers, filterable |
| PATCH  | `/api/admin/users/:id/status` | `{ status: 'banned', reason }` or `{ status: 'active' }` |
| PATCH  | `/api/admin/users/:id/documents/:type` | `{ status: 'approved' }` or `{ status: 'rejected', note }` |
| GET    | `/api/admin/fleet` | Online drivers with location and current trip |
| GET    | `/api/admin/trips/active` | All requested, accepted and ongoing rides |
| GET    | `/api/admin/rides?view=open\|reported\|cancelled\|resolved\|all` | Dispute queue, with counts per view |
| GET    | `/api/admin/rides/:id` | One ride with its full timeline, routes and trail |
| POST   | `/api/admin/rides/:id/refund` | `{ amount, reason }`, completed rides only |
| POST   | `/api/admin/rides/:id/override` | `{ status: 'completed' \| 'cancelled', reason }` |
| POST   | `/api/admin/rides/:id/resolve` | `{ resolution }` |

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE: address already in use :::5001` | Another program uses the port. Change `PORT` and `SERVER_URL` in `server/.env`, start the client with `API_PROXY=http://localhost:NEWPORT npm run dev`, and update the Google redirect URI. |
| Admin sidebar says **Reconnecting…** | The API isn't running, or the client was started before `vite.config.js` gained the `/socket.io` proxy. Restart both servers. |
| Live fleet map is grey with no streets | Map tiles come from openstreetmap.org, so the browser needs internet access. Drivers still appear in the list. |
| Live fleet map is empty | No driver is online. Run `npm run seed` with `SIMULATE_DEMO_FLEET=true`, or sign in as a verified driver and go online. |
| Driver gets "license and insurance must be approved" | Approve both documents in **Users & drivers → Documents**, or set `REQUIRE_DRIVER_VERIFICATION=false`. |
| Driver can't go online: "Location is required" | GPS mode needs location permission. Allow it in the browser's site settings (lock icon) and the phone's location settings, then try again. Over plain `http://` (not localhost), browsers block location entirely. |
| Address search shows nothing or says "Searching too fast" | Photon needs internet access and is limited to about 1 request per second. Type a few more characters and wait a moment. Set `GEOCODER=mock` to work offline. |
| Routes are straight lines | The routing service was unreachable (the server logs `routing failed`), or `ROUTING=straight`. Rides from before Level 3 also have no stored route. |
| Driver's dev panel says "Finding a route…" | Cruising needs a route from `/api/geo/route`. Check the API log for routing errors. |
| Passenger sees "No recent signal" | The driver hasn't sent a position for 30 s: GPS is lost, the driver app is in the background, or the phone is asleep. |
| Sent back to the login page with "This account has been suspended" | An admin suspended the account. Reactivate it in **Users & drivers**. |
| Signed in but landed on the wrong page | Each role has its own home page. Admin pages are only for emails in `ADMIN_EMAILS`, and the role is fixed at first sign-in. |
