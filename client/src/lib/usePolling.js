import { useEffect, useRef } from 'react';

/** Calls `fn` immediately and then every `intervalMs` while `enabled` and the tab is visible. */
export function usePolling(fn, intervalMs, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const tick = () => {
      if (!cancelled && document.visibilityState === 'visible') fnRef.current();
    };
    tick();
    const id = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs, enabled]);
}
