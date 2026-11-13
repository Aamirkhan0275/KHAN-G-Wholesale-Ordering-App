export class ApiFailure extends Error {
  constructor(public status: number, public code: string, public details?: any) { super(code); }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(fn: Listener) { unauthorizedListeners.add(fn); return () => { unauthorizedListeners.delete(fn); }; }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-kg-csrf': '1' },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as any)?.name === 'AbortError') throw e;
    throw new ApiFailure(0, 'network');
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') unauthorizedListeners.forEach((f) => f());
    throw new ApiFailure(res.status, data?.error ?? 'server_error', data?.details);
  }
  return data as T;
}

export const imageUrl = (id: string | null | undefined) => (id ? `/api/images/${id}` : null);
