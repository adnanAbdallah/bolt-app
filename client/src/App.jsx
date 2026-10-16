import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { homePathFor } from './lib/api.js';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import PassengerHome from './pages/PassengerHome.jsx';
import DriverDashboard from './pages/DriverDashboard.jsx';
import AdminHome from './pages/AdminHome.jsx';
import Spinner from './components/Spinner.jsx';

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
        <Route element={<ProtectedRoute roles={['admin']} />}>
          <Route path="/admin" element={<AdminHome />} />
        </Route>
      </Route>
      <Route path="*" element={<RoleRedirect />} />
    </Routes>
  );
}
