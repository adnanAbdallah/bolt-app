import { Circle, MapPin } from 'lucide-react';

export default function RouteSummary({ pickup, dropoff }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-start gap-3">
        <Circle className="mt-0.5 h-4 w-4 shrink-0 fill-brand-500 text-brand-500" />
        <span className="text-gray-800">{pickup}</span>
      </div>
      <div className="ml-2 h-3 border-l-2 border-dotted border-gray-300" />
      <div className="flex items-start gap-3">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <span className="text-gray-800">{dropoff}</span>
      </div>
    </div>
  );
}
