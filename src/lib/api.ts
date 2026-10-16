import { Platform } from 'react-native';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const BASE = process.env.EXPO_PUBLIC_API_URL ?? '';
const TOKEN_KEY = 'supermart.token';
let token: string | null = null;

function storage(): Storage | null {
  try {
    return Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadToken(): string | null {
  try {
    token = storage()?.getItem(TOKEN_KEY) ?? token;
  } catch {
    /* storage unavailable: stay signed-in for this page load only */
  }
  return token;
}

export function setToken(t: string | null): void {
  token = t;
  try {
    if (t) storage()?.setItem(TOKEN_KEY, t);
    else storage()?.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Call a server API method. Rejects with ApiError carrying the server's error code. */
export async function rpc<T = any>(method: string, input?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ method, input: input ?? {} }),
    });
  } catch {
    throw new ApiError('NETWORK', 'Cannot reach the SuperMart server. Is it running (npm run server)?');
  }
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('INTERNAL', `Unexpected response (${res.status}).`);
  }
  if (!body.ok) {
    if (body.error.code === 'UNAUTHENTICATED' && token && method !== 'auth.login') {
      setToken(null);
      sessionExpiredHandlers.forEach((h) => h());
    }
    throw new ApiError(body.error.code, body.error.message, body.error.details);
  }
  return body.result as T;
}

const sessionExpiredHandlers = new Set<() => void>();
export function onSessionExpired(h: () => void): () => void {
  sessionExpiredHandlers.add(h);
  return () => sessionExpiredHandlers.delete(h);
}
