import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { homePathFor } from '../lib/api.js';
import Spinner from './Spinner.jsx';

/** Requires a signed-in user; users with the wrong role are sent to their own home screen. */
export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner fullScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homePathFor(user.role)} replace />;
  return <Outlet />;
}
