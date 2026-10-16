/**
 * Serial queue that runs tasks at most once per `intervalMs`. Used to stay within the
 * public OSM services' usage policies (Photon / OSRM demo: about 1 request per second).
 */
export function createThrottle(intervalMs, { maxQueue = 20 } = {}) {
  let last = 0;
  let chain = Promise.resolve();
  let queued = 0;
  return function run(task) {
    if (queued >= maxQueue) return Promise.reject(Object.assign(new Error('Map service is busy, try again'), { status: 429 }));
    queued++;
    const p = chain.then(async () => {
      const wait = last + intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      try {
        return await task();
      } finally {
        queued--;
      }
    });
    chain = p.catch(() => {});
    return p;
  };
}

/** Small TTL + size-bounded cache (insertion-ordered Map as an LRU-ish store). */
export function createCache({ max = 500, ttlMs = 24 * 3600_000 } = {}) {
  const m = new Map();
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (Date.now() > e.exp) {
        m.delete(k);
        return undefined;
      }
      m.delete(k);
      m.set(k, e);
      return e.v;
    },
    set(k, v) {
      m.set(k, { v, exp: Date.now() + ttlMs });
      if (m.size > max) m.delete(m.keys().next().value);
    },
  };
}

/** Per-key fixed-window limiter for our own endpoints (e.g. per user). */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const e = hits.get(key);
    if (!e || now > e.reset) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 10_000) hits.clear();
      return true;
    }
    e.n++;
    return e.n <= max;
  };
}
