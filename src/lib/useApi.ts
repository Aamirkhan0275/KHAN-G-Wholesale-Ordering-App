import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from './api';

/** GET with loading/error/reload. Re-runs when `path` changes; null path = skip. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api<T>(path);
      if (my === seq.current) setData(r);
    } catch (e) {
      if (my === seq.current) setError(e instanceof ApiFailure ? e : new ApiFailure(0, 'network'));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
