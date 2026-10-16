import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Bike, Car, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api, homePathFor } from '../lib/api.js';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Spinner from '../components/Spinner.jsx';

const ERROR_MESSAGES = {
  google_not_configured: 'Google sign-in is not configured on the server yet.',
  google_no_email: 'Your Google account did not share an email address.',
  invalid_state: 'Sign-in link expired. Please try again.',
  auth_failed: 'Google sign-in was cancelled or failed.',
  server_error: 'Something went wrong on our side. Please try again.',
  account_banned: 'This account has been suspended. Contact support if you think this is a mistake.',
};

const ROLES = [
  { value: 'passenger', label: 'Ride', hint: 'Book a moto ride', icon: User },
  { value: 'driver', label: 'Drive', hint: 'Earn on your bike', icon: Car },
];

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function Login() {
  const { user, loading, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState('passenger');
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(ERROR_MESSAGES[params.get('error')] ?? null);
  const [devEmail, setDevEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.authConfig().then(setConfig).catch(() => setConfig({ googleEnabled: false, devLoginEnabled: false }));
  }, []);

  if (loading) return <Spinner fullScreen />;
  if (user) return <Navigate to={homePathFor(user.role)} replace />;

  const handleDevLogin = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { user, redirectTo } = await api.devLogin({ email: devEmail, role });
      setUser(user);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-brand-500 to-brand-700">
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-white">
        <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20">
          <Bike className="h-9 w-9" />
        </span>
        <h1 className="text-3xl font-bold">Bolt Moto</h1>
        <p className="mt-2 text-white/80">Fast, affordable motorcycle rides.</p>
      </div>

      <div className="rounded-t-3xl bg-white px-6 pt-8 pb-10 shadow-2xl">
        <div className="mx-auto max-w-sm">
          <ErrorBanner message={error} onClose={() => setError(null)} />

          <p className="mb-3 text-sm font-medium text-gray-500">I want to…</p>
          <div className="mb-6 grid grid-cols-2 gap-3">
            {ROLES.map(({ value, label, hint, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setRole(value)}
                className={`rounded-xl border-2 p-4 text-left transition ${
                  role === value ? 'border-brand-500 bg-brand-50' : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <Icon className={`mb-2 h-5 w-5 ${role === value ? 'text-brand-600' : 'text-gray-400'}`} />
                <div className="font-semibold">{label}</div>
                <div className="text-xs text-gray-500">{hint}</div>
              </button>
            ))}
          </div>

          <a
            href={api.googleLoginUrl(role)}
            aria-disabled={config && !config.googleEnabled}
            className="btn-secondary w-full aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            <GoogleIcon />
            Continue with Google
          </a>
          <p className="mt-3 text-center text-xs text-gray-400">
            Your role is set the first time you sign in.
          </p>

          {config?.devLoginEnabled && (
            <form onSubmit={handleDevLogin} className="mt-8 border-t border-dashed border-gray-200 pt-6">
              <p className="mb-2 text-xs font-semibold tracking-wide text-amber-600 uppercase">Dev login</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={devEmail}
                  onChange={(e) => setDevEmail(e.target.value)}
                  placeholder={`${role}@example.com`}
                  className="input !pl-4"
                />
                <button className="btn-primary shrink-0" disabled={submitting}>
                  Go
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
