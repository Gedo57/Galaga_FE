import { API_URL } from './config.js';

const params = new URLSearchParams(globalThis.location?.search || '');
const userId = params.get('userId') || '';
const storageKey = `galaga.sidesix.session.v1:${API_URL}:${userId || 'local'}`;
let memoryToken = null;
let inFlight = null;

function readToken() {
  try { return globalThis.sessionStorage?.getItem(storageKey) || memoryToken; } catch { return memoryToken; }
}
function saveToken(token) {
  memoryToken = token || null;
  try {
    if (token) globalThis.sessionStorage?.setItem(storageKey, token);
    else globalThis.sessionStorage?.removeItem(storageKey);
  } catch { /* memory fallback */ }
}
function launchPayload() {
  const payload = {};
  for (const key of ['userId', 'userName', 'ts', 'nonce', 'sig', 'avatarUrl', 'locale', 'returnUrl']) {
    const value = params.get(key);
    if (value !== null && value !== '') payload[key] = value;
  }
  return payload;
}
function clearSideSixQueryFromAddress() {
  try {
    const url = new URL(globalThis.location?.href || '');
    for (const key of ['userId', 'userName', 'ts', 'nonce', 'sig', 'avatarUrl', 'locale', 'returnUrl']) url.searchParams.delete(key);
    globalThis.history?.replaceState?.(globalThis.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch { /* non-browser/test runtime */ }
}

export async function ensurePlatformSession(signal) {
  const existing = readToken();
  if (existing) { clearSideSixQueryFromAddress(); return existing; }
  if (!userId) return null;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const response = await fetch(`${API_URL}/api/platform/launch`, {
      method: 'POST',
      signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(launchPayload()),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false || !payload?.token) {
      const error = new Error(payload?.error || payload?.code || `HTTP_${response.status}`);
      error.code = payload?.code || payload?.error || `HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    saveToken(payload.token);
    clearSideSixQueryFromAddress();
    return payload.token;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

export function clearPlatformSession() { saveToken(null); }
export function platformLaunchPresent() { return Boolean(userId); }
