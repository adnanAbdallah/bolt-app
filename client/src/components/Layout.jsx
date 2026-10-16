import { Outlet, useNavigate } from 'react-router-dom';
import { Bike, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import Avatar from './Avatar.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2 font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white">
              <Bike className="h-5 w-5" />
            </span>
            Bolt Moto
            {user && (
              <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-600">
                {user.role}
              </span>
            )}
          </div>
          {user && (
            <div className="flex items-center gap-3">
              <Avatar user={user} />
              <span className="hidden text-sm font-medium sm:inline">{user.name}</span>
              <button onClick={handleLogout} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" title="Sign out">
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
