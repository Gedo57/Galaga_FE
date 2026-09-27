const DEFAULT_TOTAL_TIMEOUT_MS = 90_000;
const ATTEMPT_TIMEOUT_MS = 8_000;
const WARM_TTL_MS = 4 * 60 * 1000;
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

let warmUntil = 0;
let wakePromise = null;

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function wakeError(code, message, status = 0) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function invalidateBackendWakeState() {
  warmUntil = 0;
}

export async function waitForBackendReady(healthUrl, { force = false, totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS } = {}) {
  if (!healthUrl) throw wakeError('BACKEND_WAKE_CONFIG', 'Backend health URL is missing.');
  if (!force && Date.now() < warmUntil) return true;
  if (wakePromise) return wakePromise;

  const startedAt = Date.now();
  const deadline = startedAt + Math.max(10_000, Number(totalTimeoutMs) || DEFAULT_TOTAL_TIMEOUT_MS);

  const task = (async () => {
    let attempt = 0;
    let lastError = null;

    while (Date.now() < deadline) {
      attempt += 1;
      const remaining = deadline - Date.now();
      const controller = new AbortController();
      const timeoutId = globalThis.setTimeout(
        () => controller.abort(),
        Math.max(1000, Math.min(ATTEMPT_TIMEOUT_MS, remaining)),
      );

      try {
        globalThis.dispatchEvent?.(new CustomEvent('game:backend-wake', {
          detail: { state: attempt === 1 ? 'connecting' : 'retrying', attempt },
        }));

        const response = await fetch(healthUrl, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });

        if (response.ok) {
          warmUntil = Date.now() + WARM_TTL_MS;
          globalThis.dispatchEvent?.(new CustomEvent('game:backend-wake', {
            detail: { state: 'ready', attempt },
          }));
          return true;
        }

        if (!TRANSIENT_STATUSES.has(response.status)) {
          throw wakeError(
            'BACKEND_WAKE_FAILED',
            `Backend health check failed with status ${response.status}.`,
            response.status,
          );
        }

        lastError = wakeError(
          'BACKEND_WAKING',
          `Backend is still starting (${response.status}).`,
          response.status,
        );
      } catch (error) {
        if (error?.code === 'BACKEND_WAKE_FAILED') throw error;
        lastError = error;
      } finally {
        globalThis.clearTimeout(timeoutId);
      }

      const delayMs = Math.min(4000, 700 + (attempt * 450));
      if (Date.now() + delayMs >= deadline) break;
      await sleep(delayMs);
    }

    invalidateBackendWakeState();
    const error = wakeError(
      'BACKEND_WAKE_TIMEOUT',
      'The game server is taking too long to start. Please retry.',
    );
    error.cause = lastError || undefined;
    throw error;
  })();

  wakePromise = task;
  try {
    return await task;
  } finally {
    if (wakePromise === task) wakePromise = null;
  }
}
