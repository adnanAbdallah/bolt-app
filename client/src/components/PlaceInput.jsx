import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { api } from '../lib/api.js';

/**
 * Address field with autocomplete (server-side Photon search via /api/geo/search).
 * `place` is { address, lat, lng } or null; typing clears it until a suggestion is chosen.
 */
export default function PlaceInput({ id, label, placeholder, icon, place, onSelect, onFocus, near, action }) {
  const [text, setText] = useState(place?.address ?? '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const listId = useId();
  const seq = useRef(0);
  const blurTimer = useRef(null);

  // Reflect places set from outside (map pin, "use my location").
  useEffect(() => {
    if (place) setText(place.address);
  }, [place]);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 3 || q === place?.address) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { results } = await api.geoSearch(q, near);
        if (mine !== seq.current) return;
        setResults(results);
        setHighlight(results.length ? 0 : -1);
        setError(null);
      } catch (err) {
        if (mine === seq.current) setError(err.status === 429 ? 'Searching too fast. Wait a moment.' : "Couldn't search addresses.");
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
    // `near` only biases results; don't re-search when it moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, place?.address]);

  const choose = (r) => {
    onSelect({ address: r.address, lat: r.lat, lng: r.lng, area: r.area ?? undefined });
    setText(r.address);
    setOpen(false);
    setResults([]);
  };

  const onKeyDown = (e) => {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault();
      choose(results[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && (results.length > 0 || error);
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">{label}</label>
      <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2">{icon}</span>
      <input
        id={id}
        className={`input ${action ? 'pr-12' : ''}`}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (place && e.target.value !== place.address) onSelect(null);
        }}
        onFocus={() => {
          clearTimeout(blurTimer.current);
          setOpen(true);
          onFocus?.();
        }}
        onBlur={() => (blurTimer.current = setTimeout(() => setOpen(false), 150))}
        onKeyDown={onKeyDown}
        maxLength={200}
        autoComplete="off"
        role="combobox"
        aria-expanded={Boolean(showList)}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={highlight >= 0 && showList ? `${listId}-${highlight}` : undefined}
      />
      <span className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1">
        {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        {action}
      </span>
      {showList && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
          {error ? (
            <li className="px-4 py-2 text-sm text-red-600">{error}</li>
          ) : (
            results.map((r, i) => (
              <li
                key={`${r.lat},${r.lng},${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r)}
                onMouseEnter={() => setHighlight(i)}
                className={`flex cursor-pointer items-start gap-3 px-4 py-2.5 text-sm ${i === highlight ? 'bg-gray-50' : ''}`}
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-800">{r.address.split(', ')[0]}</span>
                  <span className="block truncate text-xs text-gray-500">{r.address.split(', ').slice(1).join(', ') || r.area}</span>
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
