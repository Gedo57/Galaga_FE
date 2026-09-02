function isLoopbackHost(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function resolveApiUrl() {
  const configured = String(import.meta.env?.VITE_API_URL || '').trim();
  const browserHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  if (configured) {
    try {
      const parsed = new URL(configured);
      // A mobile browser cannot use the PC's "localhost". When the FE itself was
      // opened through a LAN IP, transparently point the API at that same PC host.
      if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(browserHost)) parsed.hostname = browserHost;
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return configured.replace(/\/$/, '');
    }
  }

  if (typeof window === 'undefined') return 'http://localhost:3001';
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${browserHost}:3001`;
}

export const API_URL = resolveApiUrl();
export const CLIENT_VERSION = import.meta.env?.VITE_CLIENT_VERSION || '0.8.0';
export const PLAYER_ID = 'demo-player';

export const ENTRY_MIN = 50;
export const ENTRY_STEP = 50;
export const ENTRY_MAX = 1_000_000;
export const DIFFICULTIES = [
  { id: 'easy', label: 'EASY', hint: 'START x1.50', startMultiplier: 1.50 },
  { id: 'medium', label: 'MEDIUM', hint: 'START x2.25', startMultiplier: 2.25 },
  { id: 'hard', label: 'HARD', hint: 'START x4.00', startMultiplier: 4.00 }
];
