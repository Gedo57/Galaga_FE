import { API_URL } from './config.js';

const searchParams = new URLSearchParams(globalThis.location?.search || '');

function consumePlatformFragment() {
  const raw = String(globalThis.location?.hash || '').replace(/^#/, '');
  if (!raw.includes('platform_launch_token=')) return null;
  const params = new URLSearchParams(raw);
  const launchToken = params.get('platform_launch_token') || '';
  if (!launchToken) return null;
  const context = {
    launchToken,
    launchId: params.get('platform_launch_id') || '',
    returnUrl: params.get('platform_return_url') || '',
    exchangeId: globalThis.crypto?.randomUUID?.() || `galaga-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  };
  try {
    globalThis.history?.replaceState?.(globalThis.history.state, '', `${globalThis.location.pathname}${globalThis.location.search}`);
  } catch { /* Keep the secret launch token in module memory only. */ }
  return context;
}

const platformLaunch = consumePlatformFragment();
const sideSixLaunchPresent = Boolean(searchParams.get('userId') && searchParams.get('ts') && searchParams.get('nonce') && searchParams.get('sig'));
const launchMarker = platformLaunch
  ? `PLATFORM:${platformLaunch.launchId || platformLaunch.exchangeId}`
  : sideSixLaunchPresent
    ? `SIDESIX:${searchParams.get('userId')}:${searchParams.get('nonce')}`
    : null;
const storageKey = `galaga.wallet.session.v2:${API_URL}`;
const markerKey = `${storageKey}:launch-marker`;
let memoryToken = null;
let memoryMarker = null;
let inFlight = null;

function readToken() {
  try { return globalThis.sessionStorage?.getItem(storageKey) || memoryToken; } catch { return memoryToken; }
}
function readMarker() {
  try { return globalThis.sessionStorage?.getItem(markerKey) || memoryMarker; } catch { return memoryMarker; }
}
function saveToken(token) {
  memoryToken = token || null;
  try {
    if (token) globalThis.sessionStorage?.setItem(storageKey, token);
    else globalThis.sessionStorage?.removeItem(storageKey);
  } catch { /* memory fallback */ }
}
function saveMarker(marker) {
  memoryMarker = marker || null;
  try {
    if (marker) globalThis.sessionStorage?.setItem(markerKey, marker);
    else globalThis.sessionStorage?.removeItem(markerKey);
  } catch { /* memory fallback */ }
}

if (launchMarker && readMarker() && readMarker() !== launchMarker) saveToken(null);
if (launchMarker) saveMarker(launchMarker);

function launchPayload() {
  if (platformLaunch) return { platformLaunchToken: platformLaunch.launchToken, exchangeId: platformLaunch.exchangeId };
  if (!sideSixLaunchPresent) return null;
  const payload = {};
  for (const key of ['userId', 'userName', 'ts', 'nonce', 'sig', 'avatarUrl', 'locale', 'returnUrl']) {
    const value = searchParams.get(key);
    if (value !== null && value !== '') payload[key] = value;
  }
  return payload;
}

function clearSideSixQueryFromAddress() {
  if (!sideSixLaunchPresent) return;
  try {
    const url = new URL(globalThis.location?.href || '');
    for (const key of ['userId', 'userName', 'ts', 'nonce', 'sig', 'avatarUrl', 'locale', 'returnUrl']) url.searchParams.delete(key);
    globalThis.history?.replaceState?.(globalThis.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch { /* non-browser/test runtime */ }
}

export async function ensurePlatformSession(signal) {
  const existing = readToken();
  if (existing) { clearSideSixQueryFromAddress(); return existing; }
  const payload = launchPayload();
  if (!payload) {
    if (readMarker()?.startsWith('PLATFORM:')) {
      const error = new Error('Platform session expired. Relaunch the game from the Platform.');
      error.code = 'PLATFORM_SESSION_EXPIRED'; error.status = 401; throw error;
    }
    return null;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const response = await fetch(`${API_URL}/api/platform/launch`, {
      method: 'POST', signal, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok === false || !result?.token) {
      const error = new Error(result?.error || result?.code || `HTTP_${response.status}`);
      error.code = result?.code || result?.error || `HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    saveToken(result.token);
    clearSideSixQueryFromAddress();
    return result.token;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

export function clearPlatformSession() { saveToken(null); }
export function platformLaunchPresent() { return Boolean(platformLaunch || sideSixLaunchPresent); }
