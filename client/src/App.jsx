import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { homePathFor } from './lib/api.js';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import PassengerHome from './pages/PassengerHome.jsx';
import DriverDashboard from './pages/DriverDashboard.jsx';
import Spinner from './components/Spinner.jsx';

// Admin code (incl. the Leaflet map) is only downloaded by admins.
const AdminLayout = lazy(() => import('./components/admin/AdminLayout.jsx'));
const Overview = lazy(() => import('./pages/admin/Overview.jsx'));
const Fleet = lazy(() => import('./pages/admin/Fleet.jsx'));
const Users = lazy(() => import('./pages/admin/Users.jsx'));
const Trips = lazy(() => import('./pages/admin/Trips.jsx'));
const Disputes = lazy(() => import('./pages/admin/Disputes.jsx'));

function RoleRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner fullScreen />;
  return <Navigate to={user ? homePathFor(user.role) : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<Layout />}>
        <Route element={<ProtectedRoute roles={['passenger']} />}>
          <Route path="/ride" element={<PassengerHome />} />
        </Route>
        <Route element={<ProtectedRoute roles={['driver']} />}>
          <Route path="/driver" element={<DriverDashboard />} />
        </Route>
      </Route>

      {/* Admin-only. The API enforces this too; the client guard just keeps others out of the UI. */}
      <Route element={<ProtectedRoute roles={['admin']} />}>
        <Route
          path="/admin"
          element={
            <Suspense fallback={<Spinner fullScreen />}>
              <AdminLayout />
            </Suspense>
          }
        >
          <Route index element={<Overview />} />
          <Route path="fleet" element={<Fleet />} />
          <Route path="users" element={<Users />} />
          <Route path="trips" element={<Trips />} />
          <Route path="disputes" element={<Disputes />} />
        </Route>
      </Route>

      <Route path="*" element={<RoleRedirect />} />
    </Routes>
  );
}
