# Bolt Moto — Level 1 MVP

Motorcycle ride-hailing app: Google sign-in, passenger booking with dynamic fares, and a driver dashboard that moves rides through `requested → accepted → ongoing → completed`.

## Structure

```
server/                      Express + Mongoose API (port 5001)
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

In development, Vite proxies `/api` to `localhost:5001`, so the auth cookie is same-origin.

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
