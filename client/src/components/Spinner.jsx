import { Loader2 } from 'lucide-react';

export default function Spinner({ fullScreen = false, className = '' }) {
  const icon = <Loader2 className={`h-6 w-6 animate-spin text-brand-500 ${className}`} />;
  return fullScreen ? <div className="flex min-h-screen items-center justify-center">{icon}</div> : icon;
}
