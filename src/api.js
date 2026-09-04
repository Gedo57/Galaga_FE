import { API_URL, CLIENT_VERSION } from './config.js';

async function request(path, options = {}) {
  const controller = new AbortController();
  const { timeoutMs: rawTimeoutMs, simpleJson = false, headers: optionHeaders = {}, ...fetchOptions } = options;
  const timeoutMs = Math.max(2000, Number(rawTimeoutMs || 9000));
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = simpleJson
      ? { 'Content-Type': 'text/plain;charset=UTF-8', ...optionHeaders }
      : { 'Content-Type': 'application/json', 'X-Client-Version': CLIENT_VERSION, ...optionHeaders };
    const response = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      headers,
      signal: fetchOptions.signal || controller.signal
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
  ensurePlayer: (playerId) => request('/api/players/ensure', { method: 'POST', body: JSON.stringify({ playerId }) }),
  player: (playerId) => request(`/api/players/${encodeURIComponent(playerId)}`),
  startSession: ({ playerId, entryAmount, difficulty }) => request('/api/sessions/start', {
    method: 'POST', body: JSON.stringify({ playerId, entryAmount, difficulty })
  }),
  setCountdown: (sessionId) => request(`/api/sessions/${sessionId}/countdown`, { method: 'POST' }),
  beginSession: (sessionId) => request(`/api/sessions/${sessionId}/begin`, { method: 'POST' }),
  saveCoreState: (sessionId, snapshot, { reason = 'periodic' } = {}) => request(`/api/sessions/${sessionId}/core-state`, {
    method: 'POST',
    body: JSON.stringify(snapshot),
    timeoutMs: reason === 'bomb' ? 4500 : 4000,
    // text/plain is a CORS-safelisted Content-Type. The backend parses JSON
    // independent of Content-Type, so core-state sync avoids an OPTIONS roundtrip.
    simpleJson: true
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
