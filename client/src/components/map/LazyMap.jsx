import { lazy, Suspense } from 'react';

// Leaflet is ~150 kB; load it only on screens that actually show a map.
const MapView = lazy(() => import('./Map.jsx'));

export default function LazyMap(props) {
  return (
    <Suspense fallback={<div className={`animate-pulse bg-gray-100 ${props.className ?? ''}`} aria-hidden="true" />}>
      <MapView {...props} />
    </Suspense>
  );
}
