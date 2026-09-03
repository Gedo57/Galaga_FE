const PRODUCTION_API_URL = 'https://galaga-be.onrender.com';

function normalizeHost(hostname = '') {
  return String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function isLoopbackHost(hostname = '') {
  const host = normalizeHost(hostname);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isPrivateLanHost(hostname = '') {
  const host = normalizeHost(hostname);
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,2})\./);
  if (match) {
    const second = Number(match[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function isLocalDevelopmentHost(hostname = '') {
  return isLoopbackHost(hostname) || isPrivateLanHost(hostname);
}

function resolveApiUrl() {
  const configured = String(import.meta.env?.VITE_API_URL || '').trim();
  const hasWindow = typeof window !== 'undefined';
  const browserHost = hasWindow ? window.location.hostname : 'localhost';
  const browserIsLocal = isLocalDevelopmentHost(browserHost);

  if (configured) {
    try {
      const parsed = new URL(configured);
      const configuredIsLocal = isLocalDevelopmentHost(parsed.hostname);

      // Never allow a localhost/LAN API setting to leak into a public deploy.
      // This previously turned http://localhost:3001 into
      // http(s)://<vercel-domain>:3001 and caused ERR_CONNECTION_TIMED_OUT.
      if (configuredIsLocal && !browserIsLocal) return PRODUCTION_API_URL;

      // Mobile/LAN development: if FE is opened through the PC's LAN IP while
      // VITE_API_URL points at localhost, send the API request to that same PC.
      if (configuredIsLocal && browserIsLocal && isLoopbackHost(parsed.hostname) && isPrivateLanHost(browserHost)) {
        parsed.hostname = browserHost;
      }

      return parsed.toString().replace(/\/$/, '');
    } catch {
      // An invalid configured URL should never break a public production build.
      return browserIsLocal ? configured.replace(/\/$/, '') : PRODUCTION_API_URL;
    }
  }

  if (!hasWindow) return 'http://localhost:3001';

  // Local/LAN development keeps the convenient same-host :3001 behavior.
  if (browserIsLocal) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${browserHost}:3001`;
  }

  // Any public deployment (Vercel or a custom domain) uses Render by default.
  return PRODUCTION_API_URL;
}

export const API_URL = resolveApiUrl();
export const CLIENT_VERSION = import.meta.env?.VITE_CLIENT_VERSION || '0.8.1';

const PLAYER_STORAGE_KEY = 'galaga.player.id.v1';
const PLAYER_ID_PATTERN = /^player-[a-z0-9_-]{12,96}$/i;

function createBrowserPlayerId() {
  if (globalThis.crypto?.randomUUID) return `player-${globalThis.crypto.randomUUID()}`;
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `player-${token}`;
  }
  return `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function resolvePlayerId() {
  if (typeof window === 'undefined') return 'player-server-runtime';

  try {
    const stored = String(window.localStorage.getItem(PLAYER_STORAGE_KEY) || '').trim();
    if (PLAYER_ID_PATTERN.test(stored)) return stored;

    // Deliberately do not reuse the old shared demo-player identity.
    const created = createBrowserPlayerId();
    window.localStorage.setItem(PLAYER_STORAGE_KEY, created);
    return created;
  } catch {
    // Private browsing / blocked storage fallback: stable for this page lifetime.
    if (!window.__GALAGA_PLAYER_ID__) window.__GALAGA_PLAYER_ID__ = createBrowserPlayerId();
    return window.__GALAGA_PLAYER_ID__;
  }
}

export const PLAYER_ID = resolvePlayerId();

export const ENTRY_MIN = 50;
export const ENTRY_STEP = 50;
export const ENTRY_MAX = 1_000_000;
export const DIFFICULTIES = [
  { id: 'easy', label: 'EASY', hint: 'START x1.50', startMultiplier: 1.50 },
  { id: 'medium', label: 'MEDIUM', hint: 'START x2.25', startMultiplier: 2.25 },
  { id: 'hard', label: 'HARD', hint: 'START x4.00', startMultiplier: 4.00 }
];
