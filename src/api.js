import { API_URL, CLIENT_VERSION } from './config.js';

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(2000, Number(options.timeoutMs || 9000));
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Version': CLIENT_VERSION,
        ...(options.headers || {})
      },
      ...options,
      signal: options.signal || controller.signal
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
      const error = new Error(payload?.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Server request timed out');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  health: () => request('/api/health', { timeoutMs: 5000 }),
  player: (playerId) => request(`/api/players/${encodeURIComponent(playerId)}`),
  startSession: ({ playerId, entryAmount, difficulty }) => request('/api/sessions/start', {
    method: 'POST', body: JSON.stringify({ playerId, entryAmount, difficulty })
  }),
  setCountdown: (sessionId) => request(`/api/sessions/${sessionId}/countdown`, { method: 'POST' }),
  beginSession: (sessionId) => request(`/api/sessions/${sessionId}/begin`, { method: 'POST' }),
  saveCoreState: (sessionId, snapshot) => request(`/api/sessions/${sessionId}/core-state`, {
    method: 'POST', body: JSON.stringify(snapshot), timeoutMs: 5500
  }),
  clearWave: (sessionId, snapshot) => request(`/api/sessions/${sessionId}/wave-clear`, {
    method: 'POST', body: JSON.stringify(snapshot)
  }),
  nextWave: (sessionId) => request(`/api/sessions/${sessionId}/next-wave`, { method: 'POST' }),
  checkpointDecision: (sessionId, action) => request(`/api/sessions/${sessionId}/checkpoint-decision`, {
    method: 'POST', body: JSON.stringify({ action })
  }),
  closeSession: (sessionId) => request(`/api/sessions/${sessionId}/close`, { method: 'POST' }),
  loseSession: (sessionId, snapshot) => request(`/api/sessions/${sessionId}/lose`, {
    method: 'POST', body: JSON.stringify(snapshot)
  }),
  abandonSession: (sessionId) => request(`/api/sessions/${sessionId}/abandon`, { method: 'POST' }),
  getSession: (sessionId) => request(`/api/sessions/${sessionId}`)
};
