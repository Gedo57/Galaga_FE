import './styles.css';
import { api } from './api.js';
import { audioManager } from './audioManager.js';
import { DIFFICULTIES, ENTRY_MIN, ENTRY_STEP, ENTRY_MAX, PLAYER_ID } from './config.js';
import { CoreGameplayEngine } from './gameEngine.js';
import { checkpointMultiplierForDifficulty, performanceRating, scoreGateForDifficulty, startMultiplierForDifficulty, waveDefinition } from './waveConfig.js';
import { GameState, StateMachine } from './stateMachine.js';

const app = document.querySelector('#app');
const machine = new StateMachine(GameState.MENU);
const DECISION_SECONDS = 8;
const CASHOUT_WAVES = Object.freeze([3, 5, 7, 9, 10]);

const AUDIO_GAMEPLAY_STATES = new Set([
  GameState.COUNTDOWN,
  GameState.WAVE_PLAYING,
  GameState.WAVE_CLEAR,
  GameState.CHECKPOINT,
  GameState.RESULT,
  GameState.RUN_LOST,
  GameState.BOSS_COMPLETE
]);

function musicTrackForState(state) {
  return AUDIO_GAMEPLAY_STATES.has(state) ? 'gameplay' : 'menu';
}

function audioSettingsMarkup() {
  const settings = audioManager.snapshot();
  const musicPercent = Math.round(settings.musicVolume * 100);
  const sfxPercent = Math.round(settings.sfxVolume * 100);
  return `<button class="audio-settings-button" type="button" data-action="audio-settings-open" aria-label="Audio settings" title="Audio settings"><span aria-hidden="true">⚙</span></button>
    <div class="audio-settings-overlay" data-audio-settings-overlay aria-hidden="true">
      <div class="audio-settings-panel" role="dialog" aria-modal="true" aria-label="Audio settings">
        <div class="audio-settings-head"><div><small>AUDIO</small><strong>SETTINGS</strong></div><button type="button" data-action="audio-settings-close" aria-label="Close settings">×</button></div>
        <button class="audio-mute-button ${settings.muted ? 'muted' : ''}" type="button" data-action="audio-mute">
          <span class="audio-mute-icon" aria-hidden="true">${settings.muted ? '🔇' : '🔊'}</span>
          <span data-audio-mute-label>${settings.muted ? 'UNMUTE ALL' : 'MUTE ALL'}</span>
        </button>
        <label class="audio-slider-row">
          <span><b>MUSIC</b><em data-music-volume-label>${musicPercent}%</em></span>
          <input type="range" min="0" max="100" step="1" value="${musicPercent}" data-audio-music-volume aria-label="Music volume" />
        </label>
        <label class="audio-slider-row">
          <span><b>SOUND EFFECTS</b><em data-sfx-volume-label>${sfxPercent}%</em></span>
          <input type="range" min="0" max="100" step="1" value="${sfxPercent}" data-audio-sfx-volume aria-label="Sound effects volume" />
        </label>
      </div>
    </div>`;
}

function syncAudioSettingsUi() {
  const settings = audioManager.snapshot();
  const overlay = app.querySelector('[data-audio-settings-overlay]');
  const muteButton = app.querySelector('[data-action="audio-mute"]');
  const muteIcon = muteButton?.querySelector('.audio-mute-icon');
  const muteLabel = app.querySelector('[data-audio-mute-label]');
  const musicInput = app.querySelector('[data-audio-music-volume]');
  const sfxInput = app.querySelector('[data-audio-sfx-volume]');
  const musicLabel = app.querySelector('[data-music-volume-label]');
  const sfxLabel = app.querySelector('[data-sfx-volume-label]');
  if (muteButton) muteButton.classList.toggle('muted', settings.muted);
  if (muteIcon) muteIcon.textContent = settings.muted ? '🔇' : '🔊';
  if (muteLabel) muteLabel.textContent = settings.muted ? 'UNMUTE ALL' : 'MUTE ALL';
  if (musicInput) musicInput.value = String(Math.round(settings.musicVolume * 100));
  if (sfxInput) sfxInput.value = String(Math.round(settings.sfxVolume * 100));
  if (musicLabel) musicLabel.textContent = `${Math.round(settings.musicVolume * 100)}%`;
  if (sfxLabel) sfxLabel.textContent = `${Math.round(settings.sfxVolume * 100)}%`;
  if (overlay) overlay.dataset.muted = settings.muted ? 'true' : 'false';
}

function openAudioSettings() {
  const overlay = app.querySelector('[data-audio-settings-overlay]');
  if (!overlay) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  syncAudioSettingsUi();
}
function closeAudioSettings() {
  const overlay = app.querySelector('[data-audio-settings-overlay]');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

function handleAudioEvent(event = {}) {
  const type = String(event.type || '');
  if (type === 'player-fire') {
    audioManager.playSfx('laser', { volume: event.overdrive ? 0.30 : 0.24, rate: event.overdrive ? 1.18 : 1.06, poolSize: 8 });
  } else if (type === 'enemy-fire') {
    audioManager.playSfx('enemyFire', { volume: 0.22, rate: 1, throttleMs: 70, poolSize: 7 });
  } else if (type === 'enemy-destroyed') {
    const enemyType = String(event.enemyType || '');
    const bossLike = ['miniBoss', 'finalBoss'].includes(enemyType);
    if (bossLike) audioManager.playSfx('explosion', { volume: 0.72, rate: 0.86, poolSize: 3 });
    else audioManager.playSfx('enemyDestroy', { volume: 0.18, rate: enemyType === 'heavy' || enemyType === 'elite' ? 0.92 : 1.04, throttleMs: 75, poolSize: 6 });
  } else if (type === 'boss-laser-telegraph') {
    screen.classList.remove('laser-warning-live'); void screen.offsetWidth; screen.classList.add('laser-warning-live');
    window.setTimeout(() => screen.classList.remove('laser-warning-live'), Math.max(650, Number(event.telegraph || 1) * 1000));
  } else if (type === 'boss-laser-fire') {
    screen.classList.remove('laser-fire-live'); void screen.offsetWidth; screen.classList.add('laser-fire-live');
    window.setTimeout(() => screen.classList.remove('laser-fire-live'), 260);
  } else if (type === 'player-hit') {
    if (Number(event.lives || 0) <= 0) audioManager.playSfx('explosion', { volume: 0.82, rate: 0.92, poolSize: 3 });
  } else if (type === 'dive-flyby') {
    audioManager.playSfx('diveFlyby', { volume: 0.40, rate: 1, throttleMs: 90, poolSize: 4 });
  } else if (type === 'boss-laser-telegraph') {
    audioManager.playSfx('chargeUp', { volume: 0.52, rate: 0.92, throttleMs: 250, poolSize: 2 });
  } else if (type === 'boss-laser-fire') {
    audioManager.playSfx('laser', { volume: 0.70, rate: 0.66, poolSize: 3 });
  }
}

const ROUTE_PATHS = Object.freeze({
  menu: '/main-menu',
  entry: '/entry',
  gameplay: '/gameplay'
});
const GAMEPLAY_ROUTE_STATES = new Set([
  GameState.COUNTDOWN,
  GameState.WAVE_PLAYING,
  GameState.WAVE_CLEAR,
  GameState.CHECKPOINT,
  GameState.RESULT,
  GameState.RUN_LOST,
  GameState.BOSS_COMPLETE
]);

function normalizedPathname() {
  const path = String(window.location.pathname || '/').replace(/\/+$/, '') || '/';
  return path.toLowerCase();
}
function routeKindFromLocation() {
  const path = normalizedPathname();
  if (path === ROUTE_PATHS.entry) return 'entry';
  if (path === ROUTE_PATHS.gameplay) return 'gameplay';
  if (path === ROUTE_PATHS.menu || path === '/') return 'menu';
  return 'unknown';
}
function routePathForState(state) {
  if ([GameState.ENTRY_SELECTED, GameState.ENTRY_PAID].includes(state)) return ROUTE_PATHS.entry;
  if (GAMEPLAY_ROUTE_STATES.has(state)) return ROUTE_PATHS.gameplay;
  return ROUTE_PATHS.menu;
}
function syncRouteToState(state, { replace = false } = {}) {
  const target = routePathForState(state);
  if (normalizedPathname() === target) return;
  window.history[replace ? 'replaceState' : 'pushState']({ galagaRoute: true }, '', target);
}
function normalizeInitialRoute() {
  const kind = routeKindFromLocation();
  if (kind === 'unknown' || normalizedPathname() === '/') {
    window.history.replaceState({ galagaRoute: true }, '', ROUTE_PATHS.menu);
    return 'menu';
  }
  return kind;
}
const initialRouteKind = normalizeInitialRoute();


const emptyStats = () => ({
  kills: 0, shotsFired: 0, shotsHit: 0, damageTaken: 0, accuracy: 0,
  killsByType: { fighter: 0, diver: 0, shooter: 0, heavy: 0, charger: 0, elite: 0, miniBoss: 0, finalBoss: 0 },
  bombKillsByType: { fighter: 0, diver: 0, shooter: 0, heavy: 0, charger: 0, elite: 0, miniBoss: 0, finalBoss: 0 },
  patternActivations: {}, lastPattern: '', comboIndex: 0, comboMultiplier: 1,
  enemiesRemaining: 0, miniBossHp: 0, miniBossMaxHp: 0, finalBossHp: 0, finalBossMaxHp: 0, finalBossPhase: 0,
  overdriveEnergy: 0, overdriveActiveRemaining: 0, bombAvailable: true, bombUsed: false, waveElapsed: 0
});

const model = {
  player: { id: PLAYER_ID, balance: 0, activeSessionId: null },
  selectedEntry: 50,
  selectedDifficulty: 'medium',
  session: null,
  busy: false,
  error: '',
  countdown: null,
  score: 0,
  wave: 1,
  lives: 3,
  stats: emptyStats(),
  lastWaveResult: null,
  checkpoint: null
};

let activeEngine = null;
let snapshotBusy = false;
let runLostPending = false;
let waveClearPending = false;
let checkpointDecisionPending = false;
let checkpointClock = null;
let autoAdvanceToken = 0;
let bombDoubleTapAt = 0;
let bombDoubleTapTarget = null;
const BOMB_DOUBLE_TAP_WINDOW_MS = 460;


// Startup preloader: load every main-menu visual plus most gameplay/UI assets before
// the first interactive screen is rendered. Advanced boss variants continue in the
// background after boot so the menu appears as soon as the essential cache is ready.
const STARTUP_ASSETS = Object.freeze([
  '/assets/mainmenu/background-landscape-clean.png',
  '/assets/mainmenu/background-landscape.png',
  '/assets/mainmenu/background-portrait.png',
  '/assets/mainmenu/fleet/ship-main-blue.png',
  '/assets/mainmenu/fleet/ship-left-orange.png',
  '/assets/mainmenu/fleet/ship-left-purple.png',
  '/assets/mainmenu/fleet/ship-right-orange.png',
  '/assets/mainmenu/fleet/ship-right-purple.png',
  '/assets/mainmenu/play-button.png',
  '/assets/gameplay/background-landscape.png',
  '/assets/gameplay/background-portrait.png',
  '/assets/gameplay/hud.png',
  '/assets/ui/panel-button-blue.png',
  '/assets/ui/panel-button-red.png',
  '/assets/ui/panel-entry-blue.png',
  '/assets/ui/panel-portrait-blue.png',
  '/assets/ui/panel-square-blue-a.png',
  '/assets/ui/panel-square-blue-b.png',
  '/assets/ui/panel-wide-blue.png',
  '/assets/ui/panel-wide-red.png',
  '/assets/player/ship.png',
  '/assets/player/bullet-01.png',
  '/assets/player/bullet-02.png',
  '/assets/player/bomb.png',
  '/assets/player/overdrive.png',
  '/assets/player/shield.png',
  '/assets/enemies/Enemy_01_Fighter.png',
  '/assets/enemies/Enemy_01_Fighter_Bullet_01.png',
  '/assets/enemies/Enemy_02_Diver.png',
  '/assets/enemies/Enemy_02_Diver_Bullet_01.png',
  '/assets/enemies/Enemy_02_Dive_Trail_01.png',
  '/assets/enemies/Enemy_02_Dive_Warning_01.png',
  '/assets/enemies/Enemy_03_Shooter.png',
  '/assets/enemies/Enemy_03_Shooter_Bullet_01.png',
  '/assets/enemies/Enemy_03_Shooter_ChargedShot_01.png',
  '/assets/enemies/Enemy_04_Heavy.png',
  '/assets/enemies/Enemy_04_Heavy_Bullet_01.png',
  '/assets/enemies/Enemy_05_Charger.png',
  '/assets/enemies/Enemy_05_Charge_Trail_01.png',
  '/assets/enemies/Enemy_05_Charge_Impact_01.png',
  '/assets/enemies/Enemy_06_Elite.png',
  '/assets/enemies/Enemy_06_Elite_Bullet_01.png',
  '/assets/enemies/Enemy_06_Elite_Special_Bullet_01.png',
  '/assets/bosses/MiniBoss_01.png',
  '/assets/bosses/MiniBoss_Bullet_01.png',
  '/assets/bosses/MiniBoss_Spread_Bullet_01.png',
  '/assets/bosses/MiniBoss_Phase2_Aura_01.png',
  '/assets/bosses/FinalBoss_01.png',
  '/assets/bosses/FinalBoss_Bullet_01.png',
  '/assets/bosses/FinalBoss_Spread_Bullet_01.png',
  '/assets/bosses/FinalBoss_Laser_Telegraph_01.png',
  '/assets/bosses/FinalBoss_Laser_Beam_01.png',
  '/assets/vfx/Enemy_Spawn_Effect_01.png',
  '/assets/vfx/Explosion_Generic_01.png',
  '/assets/vfx/Hit_Impact_01.png',
  '/assets/audio/music-main-menu.mp3',
  '/assets/audio/music-gameplay.mp3',
  '/assets/audio/sfx-laser.mp3',
  '/assets/audio/sfx-explosion.mp3',
  '/assets/audio/sfx-wave-start.mp3',
  '/assets/audio/sfx-wave-clear.mp3'
]);

const DEFERRED_ASSETS = Object.freeze([
  '/assets/bosses/MiniBoss_Alternating_Spread_Bullet_01.png',
  '/assets/bosses/MiniBoss_Arc_Sweep_Bullet_01.png',
  '/assets/bosses/MiniBoss_Heavy_Charge_01.png',
  '/assets/bosses/MiniBoss_Heavy_Projectile_01.png',
  '/assets/bosses/MiniBoss_Phase2_Transition_01.png',
  '/assets/bosses/MiniBoss_Target_Reticle_01.png',
  '/assets/bosses/MiniBoss_TripleAim_Bullet_01.png',
  '/assets/bosses/MiniBoss_TripleAim_Charge_01.png',
  '/assets/audio/sfx-coin-spend.mp3',
  '/assets/audio/sfx-charge-up.mp3',
  '/assets/audio/sfx-enemy-fire.mp3',
  '/assets/audio/sfx-enemy-destroy.mp3',
  '/assets/audio/sfx-dive-flyby.mp3',
  '/assets/audio/sfx-bomb-blast.mp3'
]);

const PRELOAD_CONCURRENCY = 6;
const PRELOAD_TIMEOUT_MS = 20000;

function loadingScreenMarkup() {
  return `<main class="startup-loader" data-startup-loader role="status" aria-live="polite">
    <div class="startup-loader-core">
      <div class="startup-loader-copy" data-loading-status>Loading....</div>
      <div class="startup-loader-track" aria-hidden="true"><span data-loading-bar></span></div>
      <div class="startup-loader-percent" data-loading-percent>0%</div>
      <div class="startup-loader-count" data-loading-count>0 / ${STARTUP_ASSETS.length}</div>
    </div>
  </main>`;
}

function showLoadingScreen() {
  if (!app.querySelector('[data-startup-loader]')) app.innerHTML = loadingScreenMarkup();
  updateLoadingProgress(0, 0, STARTUP_ASSETS.length, 'Loading....');
}

function updateLoadingProgress(percent, completed, total, status = 'Loading....') {
  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const bar = app.querySelector('[data-loading-bar]');
  const label = app.querySelector('[data-loading-percent]');
  const count = app.querySelector('[data-loading-count]');
  const statusNode = app.querySelector('[data-loading-status]');
  if (bar) bar.style.width = `${safePercent}%`;
  if (label) label.textContent = `${safePercent}%`;
  if (count) count.textContent = `${Math.max(0, Number(completed) || 0)} / ${Math.max(0, Number(total) || 0)}`;
  if (statusNode) statusNode.textContent = status;
}

function preloadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve({ url, ok });
    };
    const timer = window.setTimeout(() => finish(false), PRELOAD_TIMEOUT_MS);
    image.onload = async () => {
      if (typeof image.decode === 'function') {
        try { await image.decode(); } catch {}
      }
      finish(true);
    };
    image.onerror = () => finish(false);
    image.decoding = 'async';
    image.src = url;
  });
}

async function preloadBinary(url) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PRELOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: 'force-cache', signal: controller.signal });
    if (!response.ok) return { url, ok: false };
    await response.arrayBuffer();
    return { url, ok: true };
  } catch {
    return { url, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function preloadOne(url) {
  return /\.(?:png|jpe?g|webp|gif|svg)(?:\?|$)/i.test(url) ? preloadImage(url) : preloadBinary(url);
}

async function preloadAssets(urls, { onProgress } = {}) {
  const assets = [...new Set(urls)];
  const results = [];
  let cursor = 0;
  let completed = 0;

  const worker = async () => {
    while (cursor < assets.length) {
      const index = cursor++;
      const result = await preloadOne(assets[index]);
      results[index] = result;
      completed += 1;
      onProgress?.({ completed, total: assets.length, result });
    }
  };

  const workerCount = Math.min(PRELOAD_CONCURRENCY, Math.max(1, assets.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return {
    total: assets.length,
    loaded: results.filter((item) => item?.ok).length,
    failed: results.filter((item) => item && !item.ok).map((item) => item.url)
  };
}

function preloadDeferredAssets() {
  window.setTimeout(() => {
    preloadAssets(DEFERRED_ASSETS).then((summary) => {
      if (summary.failed.length) console.warn('Deferred asset preload skipped:', summary.failed);
    }).catch(() => {});
  }, 0);
}

// Phase 7 presentation-only telemetry. This never changes gameplay authority or payout logic.
const visualTelemetry = {
  score: 0, lives: 3, damageTaken: 0, bossPhase: 0, overdriveActive: false, wave: 1, multiplier: 0
};
let feedbackSerial = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function money(value) { return new Intl.NumberFormat('en-US').format(Number(value || 0)); }
function formatMultiplierValue(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
function activeDifficulty() { return model.session?.difficulty || model.selectedDifficulty || 'medium'; }
function runStartMultiplier(difficulty = activeDifficulty()) { return startMultiplierForDifficulty(difficulty); }
function checkpointMultiplier(wave, difficulty = activeDifficulty()) { return checkpointMultiplierForDifficulty(wave, difficulty); }
function checkpointScoreGate(wave, difficulty = activeDifficulty()) { return scoreGateForDifficulty(wave, difficulty); }
function nextCheckpointAfter(wave, difficulty = activeDifficulty()) {
  const nextWave = CASHOUT_WAVES.find((candidate) => candidate > Number(wave || 0));
  return nextWave ? { wave: nextWave, multiplier: checkpointMultiplier(nextWave, difficulty), scoreGate: checkpointScoreGate(nextWave, difficulty) } : null;
}
function maxAffordableEntry() {
  const balance = Math.max(0, Number(model.player.balance || 0));
  return Math.min(ENTRY_MAX, Math.floor(balance / ENTRY_STEP) * ENTRY_STEP);
}
function normalizeEntry(value, { clampToWallet = true } = {}) {
  const raw = Number(value);
  const safe = Number.isFinite(raw) ? raw : ENTRY_MIN;
  const stepped = Math.round(safe / ENTRY_STEP) * ENTRY_STEP;
  const upper = clampToWallet ? Math.max(ENTRY_MIN, maxAffordableEntry()) : ENTRY_MAX;
  return Math.max(ENTRY_MIN, Math.min(upper, stepped));
}
function coinGlyph(className = '') {
  return `<span class="coin-glyph ${className}" aria-hidden="true"><i></i></span>`;
}
function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function setError(message = '') { model.error = message; render(); }
function orientation() { return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'; }
document.documentElement.dataset.orientation = orientation();
function syncViewportMode() {
  document.documentElement.dataset.orientation = orientation();
  document.documentElement.dataset.compactHeight = window.innerHeight < 560 ? 'true' : 'false';
  syncBombControlLayout();
}
syncViewportMode();
window.addEventListener('resize', syncViewportMode, { passive: true });

function backgrounds(kind = 'mainmenu') {
  return `<img class="screen-bg bg-landscape" src="/assets/${kind}/background-landscape.png" alt="" draggable="false" />
          <img class="screen-bg bg-portrait" src="/assets/${kind}/background-portrait.png" alt="" draggable="false" />`;
}
function mainMenuBackgrounds() {
  return `<img class="screen-bg bg-landscape" src="/assets/mainmenu/background-landscape-clean.png" alt="" draggable="false" />
          <img class="screen-bg bg-portrait" src="/assets/mainmenu/background-portrait.png" alt="" draggable="false" />`;
}
function currencyBar() {
  return `<div class="currency-bar" aria-label="Coin balance">
    ${coinGlyph('currency-coin')}
    <div class="currency-value">${money(model.player.balance)}</div>
  </div>`;
}
function profilePanel() {
  return `<div class="profile-placeholder"><small>PLAYER PROFILE</small><strong>STARBLAST</strong></div>`;
}
function mainMenuVfxMarkup() {
  // Presentation-only deterministic particles. No gameplay/economy state is touched.
  const dust = Array.from({ length: 28 }, (_, index) => {
    const x = (index * 37 + 11) % 100;
    const y = (index * 53 + 7) % 92;
    const size = 1 + (index % 3) * 0.65;
    const duration = 8.5 + (index % 7) * 1.15;
    const delay = -((index * 0.73) % 9);
    const drift = ((index % 5) - 2) * 6;
    return `<i class="menu-dust-particle" style="--dust-x:${x}%;--dust-y:${y}%;--dust-size:${size}px;--dust-duration:${duration}s;--dust-delay:${delay}s;--dust-drift:${drift}px"></i>`;
  }).join('');
  return `<div class="mainmenu-vfx" aria-hidden="true">
    <div class="menu-parallax menu-stars-far"></div>
    <div class="menu-parallax menu-stars-mid"></div>
    <div class="menu-dust-field">${dust}</div>
    <div class="menu-logo-sweep"></div>
  </div>`;
}
function mainMenuFleetMarkup() {
  return `<div class="mainmenu-fleet" aria-hidden="true">
    <div class="fleet-ship ship-main"><img src="/assets/mainmenu/fleet/ship-main-blue.png" alt="" draggable="false" /></div>
    <div class="fleet-ship ship-left-orange"><img src="/assets/mainmenu/fleet/ship-left-orange.png" alt="" draggable="false" /></div>
    <div class="fleet-ship ship-left-purple"><img src="/assets/mainmenu/fleet/ship-left-purple.png" alt="" draggable="false" /></div>
    <div class="fleet-ship ship-right-purple"><img src="/assets/mainmenu/fleet/ship-right-purple.png" alt="" draggable="false" /></div>
    <div class="fleet-ship ship-right-orange"><img src="/assets/mainmenu/fleet/ship-right-orange.png" alt="" draggable="false" /></div>
    <div class="fleet-thruster-glow"></div>
    <div class="fleet-streaks"><i class="streak streak-1"></i><i class="streak streak-2"></i><i class="streak streak-3"></i><i class="streak streak-4"></i></div>
  </div>`;
}
function bestUnlockedTier(wave = model.wave, score = model.score, difficulty = activeDifficulty()) {
  let multiplier = 0;
  let checkpointWave = 0;
  for (const candidate of CASHOUT_WAVES) {
    if (candidate > Number(wave || 1)) break;
    const gate = checkpointScoreGate(candidate, difficulty);
    if (gate > 0 && Number(score || 0) >= gate) {
      multiplier = checkpointMultiplier(candidate, difficulty);
      checkpointWave = candidate;
    }
  }
  return { multiplier, checkpointWave };
}
function multiplierChip() {
  const tier = bestUnlockedTier();
  const start = runStartMultiplier();
  const value = tier.multiplier > 0 ? `x${tier.multiplier.toFixed(2)}` : `x${start.toFixed(2)}`;
  const label = tier.multiplier > 0 ? 'CASHOUT TIER' : 'START MULTIPLIER';
  return `<div class="multiplier-chip ${tier.multiplier > 0 ? 'unlocked' : 'starting'}"><span>${label}</span><strong data-current-multiplier>${value}</strong></div>`;
}
function resetVisualTelemetry(snapshot = {}) {
  visualTelemetry.score = Number(snapshot.score ?? model.score ?? 0);
  visualTelemetry.lives = Number(snapshot.lives ?? model.lives ?? 3);
  visualTelemetry.damageTaken = Number(snapshot.damageTaken ?? model.stats.damageTaken ?? 0);
  visualTelemetry.bossPhase = Number(snapshot.finalBossPhase ?? model.stats.finalBossPhase ?? 0);
  visualTelemetry.overdriveActive = Number(snapshot.overdriveActiveRemaining ?? model.stats.overdriveActiveRemaining ?? 0) > 0;
  visualTelemetry.wave = Number(snapshot.wave ?? model.wave ?? 1);
  visualTelemetry.multiplier = bestUnlockedTier(snapshot.wave ?? model.wave, snapshot.score ?? model.score).multiplier;
}
function emitFeedback(text, tone = 'score', options = {}) {
  const layer = app.querySelector('[data-feedback-layer]');
  if (!layer) return;
  const node = document.createElement('div');
  node.className = `floating-feedback ${tone}`;
  node.dataset.feedbackId = String(++feedbackSerial);
  node.textContent = text;
  if (options.center) node.classList.add('center');
  layer.appendChild(node);
  window.setTimeout(() => node.remove(), options.duration || 1050);
}
function pulseHud(selector, className = 'hud-pop', duration = 420) {
  const node = app.querySelector(selector);
  if (!node) return;
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
  window.setTimeout(() => node.classList.remove(className), duration);
}
function addCinematicOverlay({ kicker = '', title = '', subtitle = '', tone = 'cyan', duration = 1300 } = {}) {
  const layer = app.querySelector('[data-feedback-layer]');
  if (!layer) return;
  const node = document.createElement('div');
  node.className = `cinematic-callout ${tone}`;
  node.innerHTML = `<i class="cinematic-rail left"></i><div><span>${escapeHtml(kicker)}</span><strong>${escapeHtml(title)}</strong><em>${escapeHtml(subtitle)}</em></div><i class="cinematic-rail right"></i>`;
  layer.appendChild(node);
  window.setTimeout(() => node.remove(), duration);
}
function addRadialOverlay(className, duration = 900) {
  const layer = app.querySelector('[data-feedback-layer]');
  if (!layer) return;
  const node = document.createElement('div');
  node.className = className;
  node.innerHTML = '<i></i><i></i><i></i>';
  layer.appendChild(node);
  window.setTimeout(() => node.remove(), duration);
}
function handleVfxEvent(event = {}) {
  const type = String(event.type || '');
  if (type === 'bomb') audioManager.playSfx('bombBlast', { volume: 0.82, rate: 1, poolSize: 3 });
  else if (type === 'overdrive-start') audioManager.playSfx('chargeUp', { volume: 0.58, rate: 1.02, throttleMs: 300, poolSize: 2 });
  else if (type === 'boss-destroyed') audioManager.playSfx('explosion', { volume: 0.90, rate: 0.78, poolSize: 3 });
  else if (type === 'boss-phase' || type === 'mini-boss-phase') audioManager.playSfx('chargeUp', { volume: 0.34, rate: 0.88, throttleMs: 350, poolSize: 2 });
  const screen = app.querySelector('.gameplay-screen');
  if (!screen) return;
  if (type === 'wave-start') {
    screen.classList.remove('wave-start-live'); void screen.offsetWidth; screen.classList.add('wave-start-live');
    pulseHud('[data-hud-wave]', 'hud-wave-pop', 720);
    window.setTimeout(() => screen.classList.remove('wave-start-live'), 1250);
  } else if (type === 'boss-intro') {
    screen.classList.add('boss-cinematic-live');
    addCinematicOverlay({ kicker: 'WARNING', title: 'FINAL BOSS', subtitle: 'MULTI-PHASE THREAT DETECTED', tone: 'danger', duration: 1900 });
    addRadialOverlay('boss-warning-rings', 1750);
    window.setTimeout(() => screen.classList.remove('boss-cinematic-live'), 1900);
  } else if (type === 'mini-boss-intro') {
    addCinematicOverlay({ kicker: 'THREAT ALERT', title: 'MINI BOSS', subtitle: 'SOLO ENCOUNTER • TWO PHASES', tone: 'orange', duration: 1550 });
  } else if (type === 'mini-boss-phase') {
    screen.classList.remove('boss-phase-shock'); void screen.offsetWidth; screen.classList.add('boss-phase-shock');
    addCinematicOverlay({ kicker: 'PHASE SHIFT', title: 'MINI BOSS PHASE 2', subtitle: 'FASTER PATTERNS • SAFE GAP ATTACKS', tone: 'orange', duration: 1200 });
    window.setTimeout(() => screen.classList.remove('boss-phase-shock'), 760);
  } else if (type === 'boss-phase') {
    screen.classList.remove('boss-phase-shock'); void screen.offsetWidth; screen.classList.add('boss-phase-shock');
    addCinematicOverlay({ kicker: 'PHASE SHIFT', title: `BOSS PHASE ${event.phase || ''}`, subtitle: Number(event.phase) === 3 ? 'ENRAGED • LASER SYSTEM ONLINE' : 'ATTACK PATTERN CHANGED', tone: 'danger', duration: 1350 });
    window.setTimeout(() => screen.classList.remove('boss-phase-shock'), 850);
  } else if (type === 'boss-destroyed') {
    screen.classList.add('boss-destroyed-live');
    addRadialOverlay('boss-destroyed-burst', 1350);
    addCinematicOverlay({ kicker: 'TARGET ELIMINATED', title: 'BOSS DESTROYED', subtitle: 'RUN COMPLETE', tone: 'victory', duration: 1500 });
  } else if (type === 'bomb') {
    screen.classList.remove('bomb-live'); void screen.offsetWidth; screen.classList.add('bomb-live');
    addRadialOverlay('bomb-dom-rings', 850);
    pulseHud('.bomb-button', 'ability-pop', 700);
    window.setTimeout(() => screen.classList.remove('bomb-live'), 850);
  } else if (type === 'overdrive-start') {
    screen.classList.remove('overdrive-burst'); void screen.offsetWidth; screen.classList.add('overdrive-burst');
    addRadialOverlay('overdrive-dom-rings', 950);
    pulseHud('.overdrive-box', 'ability-pop', 760);
    pulseHud('.gameplay-hud', 'hud-energy-pop', 760);
    window.setTimeout(() => screen.classList.remove('overdrive-burst'), 1000);
  } else if (type === 'player-hit') {
    pulseHud('[data-hud-lives]', 'hud-danger-pop', 520);
    pulseHud('.gameplay-hud', 'hud-hit-pop', 520);
  }
}
function applyPolishFeedback(snapshot = {}) {
  const screen = app.querySelector('.gameplay-screen');
  if (!screen) { resetVisualTelemetry(snapshot); return; }
  const nextScore = Number(snapshot.score ?? visualTelemetry.score);
  const nextDamage = Number(snapshot.damageTaken ?? visualTelemetry.damageTaken);
  const nextLives = Number(snapshot.lives ?? visualTelemetry.lives);
  const nextBossPhase = Number(snapshot.finalBossPhase ?? 0);
  const nextOverdrive = Number(snapshot.overdriveActiveRemaining || 0) > 0;
  // UI Patch 3 removes duplicate combat text from the center of the playfield.
  // Enemy-local +score/combo feedback is already drawn by the canvas engine, so the DOM only pulses the HUD value.
  if (nextScore > visualTelemetry.score) pulseHud('[data-hud-score]', 'hud-pop');
  if (nextDamage > visualTelemetry.damageTaken || nextLives < visualTelemetry.lives) {
    screen.classList.remove('damage-flash'); void screen.offsetWidth; screen.classList.add('damage-flash');
    emitFeedback('HIT!', 'damage', { duration: 650 });
    pulseHud('[data-hud-lives]', 'hud-danger-pop', 520);
  }
  if (nextOverdrive && !visualTelemetry.overdriveActive) {
    screen.classList.add('overdrive-live');
    emitFeedback('OVERDRIVE', 'overdrive', { duration: 1050 });
  } else if (!nextOverdrive && visualTelemetry.overdriveActive) screen.classList.remove('overdrive-live');
  if (nextBossPhase > 0 && nextBossPhase !== visualTelemetry.bossPhase) {
    // The dedicated boss-phase cinematic from handleVfxEvent is the single source of phase text.
    screen.classList.remove('boss-phase-pulse'); void screen.offsetWidth; screen.classList.add('boss-phase-pulse');
  }
  const nextWave = Number(snapshot.wave ?? model.wave ?? visualTelemetry.wave);
  if (nextWave !== visualTelemetry.wave) pulseHud('[data-hud-wave]', 'hud-wave-pop', 620);
  const nextTier = bestUnlockedTier(nextWave, nextScore).multiplier;
  if (nextTier > visualTelemetry.multiplier) { pulseHud('.multiplier-chip', 'tier-unlock-pop', 900); emitFeedback(`TIER x${nextTier.toFixed(2)} UNLOCKED`, 'tier', { duration: 1050 }); }
  visualTelemetry.score = nextScore; visualTelemetry.damageTaken = nextDamage; visualTelemetry.lives = nextLives;
  visualTelemetry.bossPhase = nextBossPhase; visualTelemetry.overdriveActive = nextOverdrive; visualTelemetry.wave = nextWave; visualTelemetry.multiplier = nextTier;
}
function showWaveIntro() {
  const layer = app.querySelector('[data-feedback-layer]');
  if (!layer) return;
  const elapsed = Number(activeEngine?.snapshot?.().waveElapsed ?? model.stats.waveElapsed ?? 0);
  if (elapsed < 1.5) audioManager.playSfx('waveStart', { volume: 0.58, rate: 1, throttleMs: 700, poolSize: 2 });
  const def = waveDefinition(model.wave, activeDifficulty());
  const node = document.createElement('div');
  node.className = `wave-intro-banner ${def.final ? 'final' : ''}`;
  node.innerHTML = `<i class="wave-scanline"></i><b class="wave-rail left"></b><div><span>${def.final ? 'FINAL ENCOUNTER' : model.wave === 5 ? 'THREAT ESCALATION' : 'INCOMING'}</span><strong>WAVE ${model.wave}</strong><em>${escapeHtml(def.label)}</em></div><b class="wave-rail right"></b>`;
  layer.appendChild(node);
  window.setTimeout(() => node.remove(), def.final ? 2000 : 1500);
}
function menuScreen() {
  return `<section class="screen main-menu-screen">${mainMenuBackgrounds()}${mainMenuVfxMarkup()}${mainMenuFleetMarkup()}${profilePanel()}${currencyBar()}
    <button class="play-asset-button" type="button" data-action="play"><img src="/assets/mainmenu/play-button.png" alt="Play" /></button>
    ${model.error ? `<div class="toast">${escapeHtml(model.error)}</div>` : ''}</section>`;
}
function entryScreen() {
  const selectedDifficulty = DIFFICULTIES.find((d) => d.id === model.selectedDifficulty) || DIFFICULTIES[1];
  const maxEntry = maxAffordableEntry();
  const canAfford = maxEntry >= ENTRY_MIN && model.selectedEntry >= ENTRY_MIN && model.selectedEntry <= model.player.balance;
  const canDecrease = model.selectedEntry > ENTRY_MIN;
  const canIncrease = maxEntry >= ENTRY_MIN && model.selectedEntry + ENTRY_STEP <= maxEntry;
  return `<section class="screen entry-screen">${backgrounds('mainmenu')}${currencyBar()}
    <div class="sci-panel entry-panel">
      <div class="panel-kicker">RUN CONFIGURATION</div><h1 class="panel-title">ENTRY</h1>
      <p class="panel-subtitle">Set your Entry Amount and choose the combat difficulty.</p>
      <div class="section-label"><span>ENTRY AMOUNT</span><span>STEP • ${money(ENTRY_STEP)} COINS</span></div>
      <div class="entry-stepper" aria-label="Entry amount selector">
        <button class="entry-step-button minus" type="button" data-action="entry-minus" ${canDecrease ? '' : 'disabled'} aria-label="Decrease entry by ${ENTRY_STEP}">−</button>
        <label class="entry-number-shell">
          ${coinGlyph('entry-coin')}
          <input class="entry-number-input" data-entry-input type="number" inputmode="numeric" min="${ENTRY_MIN}" max="${Math.max(ENTRY_MIN, maxEntry)}" step="${ENTRY_STEP}" value="${model.selectedEntry}" aria-label="Entry amount" />
          <small>COINS</small>
        </label>
        <button class="entry-step-button plus" type="button" data-action="entry-plus" ${canIncrease ? '' : 'disabled'} aria-label="Increase entry by ${ENTRY_STEP}">+</button>
      </div>
      <div class="entry-range-note"><span>MIN ${money(ENTRY_MIN)}</span><span>AVAILABLE ${money(model.player.balance)}</span></div>
      <div class="section-label"><span>DIFFICULTY</span><span>START MULTIPLIER</span></div>
      <div class="choice-grid difficulty">${DIFFICULTIES.map((diff) => `<button class="choice difficulty-choice ${diff.id === model.selectedDifficulty ? 'selected' : ''}" data-difficulty="${diff.id}"><strong>${diff.label}</strong><small>${diff.hint}</small></button>`).join('')}</div>
      <div class="entry-summary"><div class="coin-inline">${coinGlyph('summary-coin')}<span data-entry-summary>${money(model.selectedEntry)}</span></div><div class="diff-inline"><span>${selectedDifficulty?.label || 'MEDIUM'}</span><small data-difficulty-multiplier>${selectedDifficulty?.hint || 'START x2.25'}</small></div></div>
      <div class="action-row"><button class="ui-button secondary" data-action="back-menu">BACK</button><button class="ui-button" data-action="start-run" ${(!canAfford || model.busy) ? 'disabled' : ''}>${model.busy ? 'CREATING SESSION…' : canAfford ? `START RUN • ${money(model.selectedEntry)}` : 'INSUFFICIENT COINS'}</button></div>
    </div>${model.error ? `<div class="toast">${escapeHtml(model.error)}</div>` : ''}</section>`;
}
function bombButtonMarkup(bombReady, { portrait = false } = {}) {
  const modeClass = portrait ? 'portrait-bomb-icon' : '';
  const doubleTapAttr = portrait ? ' data-bomb-double-tap="true"' : '';
  const ariaLabel = portrait ? (bombReady ? 'Bomb ready. Double tap to activate.' : 'Bomb used.') : (bombReady ? 'Use bomb' : 'Bomb used');
  return `<button class="bomb-button ${modeClass} ${bombReady ? '' : 'spent'}" type="button" data-action="bomb"${doubleTapAttr} ${bombReady ? '' : 'disabled'} aria-label="${ariaLabel}"><img src="/assets/player/bomb.png" alt="" /><span>${bombReady ? 'BOMB • 1' : 'BOMB • USED'}</span></button>`;
}
function gameplayHud(extra = '') {
  return `<div class="gameplay-hud"><img src="/assets/gameplay/hud.png" alt="" /><div class="hud-values"><span data-hud-score>${money(model.score)}</span><span class="wave" data-hud-wave>${model.wave}</span><span data-hud-lives>${model.lives}</span></div>${extra}</div>`;
}
function countdownOverlay() {
  if (model.countdown == null) return '';
  return `<div class="countdown"><div class="countdown-number">${model.countdown}</div><div class="countdown-label">PREPARE FOR WAVE ${model.wave}</div></div>`;
}
function gameplayScreen() {
  const touchHint = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const def = waveDefinition(model.wave, activeDifficulty());
  const overdriveActive = Number(model.stats.overdriveActiveRemaining || 0) > 0;
  const energy = Math.max(0, Math.min(100, Number(model.stats.overdriveEnergy || 0)));
  const bombReady = Boolean(model.stats.bombAvailable ?? !model.stats.bombUsed);
  const portraitLayout = orientation() === 'portrait';
  const bombControl = bombButtonMarkup(bombReady, { portrait: portraitLayout });
  const bossClass = def.final ? 'boss-wave final-boss-wave' : model.wave === 5 ? 'boss-wave mini-boss-wave' : '';
  return `<section class="screen gameplay-screen ${bossClass} ${portraitLayout ? 'layout-portrait' : 'layout-landscape'}">${backgrounds('gameplay')}
    <canvas class="game-canvas" data-game-canvas></canvas>${gameplayHud(portraitLayout ? bombControl : '')}
    <div class="gameplay-info-rail">${multiplierChip()}<div class="rail-control-hint">${touchHint ? '<strong>AUTO FIRE</strong><span>DRAG TO MOVE</span>' : '<strong>A / D OR ← / →</strong><span>SPACE FIRE</span>'}</div></div>
    <div class="feedback-layer" data-feedback-layer aria-live="polite"></div>
    <div class="combat-vignette"></div><div class="speed-lines"></div>
    <div class="wave-title-chip transient-context"><strong>WAVE ${model.wave}</strong><span>${def.label}</span></div>
    <div class="right-gameplay-stack">
      <button class="ui-button danger abandon-button" data-action="abandon">ABANDON RUN</button>
      <div class="ability-panel ${portraitLayout ? 'portrait-ability-panel' : ''}">
        <div class="overdrive-box ${overdriveActive ? 'active' : ''}"><div class="ability-head"><span>OVERDRIVE</span><strong data-overdrive-label>${overdriveActive ? `${Number(model.stats.overdriveActiveRemaining || 0).toFixed(1)}s` : `${Math.round(energy)}%`}</strong></div><div class="ability-track"><i data-overdrive-bar style="width:${overdriveActive ? 100 : energy}%"></i></div></div>
        ${portraitLayout ? '' : bombControl}
      </div>
      <div class="core-stats-panel phase4-stats">
        <div><span>COMBO</span><strong data-stat-combo>x${formatMultiplierValue(model.stats.comboMultiplier || 1)}</strong></div>
        <div><span>ACCURACY</span><strong data-stat-accuracy>${Number(model.stats.accuracy || 0).toFixed(0)}%</strong></div>
        <div><span>ENEMIES</span><strong data-stat-remaining>${model.stats.enemiesRemaining || def.enemyCount}</strong></div>
        <div class="pattern-stat"><span>PATTERN</span><strong data-stat-pattern>${prettyPattern(model.stats.lastPattern || (def.final ? 'BOSS SCRIPT' : 'FORMATION'))}</strong></div>
      </div>
    </div>
    ${countdownOverlay()}${model.error ? `<div class="toast">${escapeHtml(model.error)}</div>` : ''}</section>`;
}
function syncBombControlLayout() {
  const screen = app.querySelector('.gameplay-screen');
  if (!screen) return;
  const bombButton = screen.querySelector('[data-action="bomb"]');
  const abilityPanel = screen.querySelector('.ability-panel');
  const hud = screen.querySelector('.gameplay-hud');
  if (!bombButton || !abilityPanel || !hud) return;

  const portraitLayout = orientation() === 'portrait';
  screen.classList.toggle('layout-portrait', portraitLayout);
  screen.classList.toggle('layout-landscape', !portraitLayout);
  const target = portraitLayout ? hud : abilityPanel;
  if (bombButton.parentElement !== target) target.appendChild(bombButton);
  abilityPanel.classList.toggle('portrait-ability-panel', portraitLayout);
  bombButton.classList.toggle('portrait-bomb-icon', portraitLayout);

  if (portraitLayout) bombButton.dataset.bombDoubleTap = 'true';
  else delete bombButton.dataset.bombDoubleTap;

  bombButton.setAttribute('aria-label', portraitLayout
    ? (bombButton.disabled ? 'Bomb used.' : 'Bomb ready. Double tap to activate.')
    : (bombButton.disabled ? 'Bomb used.' : 'Use bomb'));

  bombDoubleTapAt = 0;
  bombDoubleTapTarget = null;
  bombButton.classList.remove('doubletap-armed');
}

function prettyPattern(value) { return String(value || 'FORMATION').replaceAll(/([A-Z])/g, ' $1').trim().toUpperCase(); }
function waveResultCards(result = {}) {
  return `<div class="wave-result-grid">
    <div><span>COMBAT SCORE</span><strong>${money(result.combatScore)}</strong></div>
    <div><span>ACCURACY</span><strong>${Number(result.accuracy || 0).toFixed(1)}%</strong></div>
    <div><span>ACCURACY BONUS</span><strong>+${money(result.accuracyBonus)}</strong></div>
    <div><span>PERFECT WAVE</span><strong>${result.perfectBonus ? `+${money(result.perfectBonus)}` : '—'}</strong></div>
    <div><span>ACE WAVE</span><strong>${result.aceBonus ? `+${money(result.aceBonus)}` : '—'}</strong></div>
    <div><span>TOTAL SCORE</span><strong>${money(result.scoreAfterBonuses ?? model.score)}</strong></div>
  </div>`;
}
function waveClearScreen() {
  const result = model.lastWaveResult || model.session?.waveState?.lastResult || {};
  return `<section class="screen modal-screen wave-clear-screen">${backgrounds('gameplay')}
    <div class="wave-clear-vfx"><i></i><i></i><i></i><b></b><b></b><b></b></div>
    <div class="sci-panel wave-clear-panel"><div class="panel-kicker">WAVE COMPLETE</div><h1 class="panel-title">WAVE ${result.wave || model.wave} CLEAR</h1>${waveResultCards(result)}
    <div class="wave-auto-copy"><i></i><span>NEXT WAVE INITIALIZING…</span></div></div></section>`;
}
function checkpointScreen() {
  const cp = model.checkpoint || model.session?.checkpoint || {};
  const result = model.lastWaveResult || model.session?.waveState?.lastResult || {};
  const gate = Number(cp.scoreGate || checkpointScoreGate(model.wave));
  const currentTierMultiplier = Number(cp.multiplier || checkpointMultiplier(model.wave));
  const unlocked = Boolean(cp.scoreUnlocked ?? (model.score >= gate));
  const rating = performanceRating(model.score, gate || model.score || 1);
  const entry = Number(model.session?.entryAmount || model.selectedEntry);
  const startMultiplier = runStartMultiplier();
  const currentMultiplier = Number(cp.bestUnlockedMultiplier || (unlocked ? currentTierMultiplier : startMultiplier));
  const currentReward = Number(cp.currentReward ?? Math.round(entry * currentMultiplier));
  const next = nextCheckpointAfter(model.wave) || {};
  const nextMultiplier = Number(cp.nextMultiplier || next.multiplier || 0);
  const nextReward = Number(cp.nextReward ?? (nextMultiplier ? Math.round(entry * nextMultiplier) : 0));
  const canContinue = Boolean(cp.canContinue ?? model.wave < 10);
  return `<section class="screen modal-screen checkpoint-screen">${backgrounds('gameplay')}
    <div class="sci-panel checkpoint-panel phase5-checkpoint"><div class="panel-kicker">CHECKPOINT</div><h1 class="panel-title">WAVE ${model.wave} DECISION</h1>
      <div class="decision-timer-wrap"><div class="decision-timer-head"><span>AUTO CASH OUT</span><strong><span data-checkpoint-timer>${DECISION_SECONDS}</span>s</strong></div><div class="decision-timer-track"><i data-checkpoint-progress></i></div></div>
      <div class="checkpoint-status ${unlocked ? 'unlocked' : 'locked'}"><span>CURRENT SCORE GATE</span><strong>${money(model.score)} / ${money(gate)}</strong><em>${unlocked ? `x${currentTierMultiplier.toFixed(2)} TIER UNLOCKED` : `START FLOOR x${startMultiplier.toFixed(2)} ACTIVE`}</em></div>
      ${waveResultCards(result)}
      <div class="cashout-comparison">
        <div class="cashout-card current"><span>CASH OUT NOW</span><strong>${money(currentReward)} COINS</strong><em>${cp.bestUnlockedWave ? `BEST UNLOCKED x${currentMultiplier.toFixed(2)}` : `START FLOOR x${currentMultiplier.toFixed(2)}`}</em></div>
        <div class="risk-arrow">→</div>
        <div class="cashout-card next"><span>NEXT TARGET • WAVE ${cp.nextCheckpointWave || next.wave || '—'}</span><strong>${nextReward ? `${money(nextReward)} COINS` : '—'}</strong><em>${nextMultiplier ? `x${nextMultiplier.toFixed(2)} • SCORE ${money(cp.nextScoreGate || next.scoreGate)}` : 'FINAL TIER'}</em></div>
      </div>
      <div class="checkpoint-strip"><div><span>RATING</span><strong>${rating}</strong></div><div><span>ENTRY</span><strong>${money(entry)}</strong></div><div><span>LIVES</span><strong>${model.lives}</strong></div></div>
      <p class="info-copy decision-copy">Cash Out settles the best score-gated tier reached so far. If no tier is unlocked yet, the selected difficulty's Start Multiplier is the payout floor. Continue keeps the same run and risks the unsettled reward. Timer expiry always requests Auto Cash Out.</p>
      <div class="checkpoint-actions"><button class="ui-button secondary cashout-button" data-action="cashout" ${checkpointDecisionPending ? 'disabled' : ''}>${checkpointDecisionPending ? 'SETTLING…' : `CASH OUT • ${money(currentReward)}`}</button>
      ${canContinue ? `<button class="ui-button" data-action="continue-wave" ${checkpointDecisionPending ? 'disabled' : ''}>CONTINUE TO WAVE ${model.wave + 1}</button>` : '<button class="ui-button" disabled>FINAL RUN COMPLETE</button>'}</div>
      <button class="text-danger-button" data-action="abandon">ABANDON RUN • REWARD 0</button>
    </div>${model.error ? `<div class="toast">${escapeHtml(model.error)}</div>` : ''}</section>`;
}
function resultScreen() {
  const cashout = model.session?.cashout || {};
  const reward = Number(cashout.reward ?? model.session?.reward ?? 0);
  const entry = Number(cashout.entryAmount ?? model.session?.entryAmount ?? model.selectedEntry);
  const multiplier = Number(cashout.multiplier ?? model.session?.cashoutMultiplier ?? 0);
  const net = Number(cashout.netProfit ?? reward - entry);
  const mode = String(cashout.mode || 'manual').toUpperCase();
  return `<section class="screen modal-screen result-screen">${backgrounds('gameplay')}${currencyBar()}
    <div class="sci-panel result-panel"><div class="panel-kicker">RESULT</div><h1 class="panel-title">${cashout.mode === 'boss_complete' ? 'RUN COMPLETE' : 'CASH OUT COMPLETE'}</h1>
      <div class="result-reward"><span>REWARD</span><strong>${money(reward)}</strong><em>COINS</em></div>
      <div class="result-economy-grid">
        <div><span>ENTRY</span><strong>${money(entry)}</strong></div>
        <div><span>MULTIPLIER</span><strong>${multiplier > 0 ? `x${multiplier.toFixed(2)}` : 'NO TIER'}</strong></div>
        <div><span>CASHOUT WAVE</span><strong>${cashout.wave || model.wave}</strong></div>
        <div><span>FINAL SCORE</span><strong>${money(cashout.score ?? model.score)}</strong></div>
        <div><span>NET</span><strong class="${net >= 0 ? 'positive' : 'negative'}">${net >= 0 ? '+' : ''}${money(net)}</strong></div>
        <div><span>SETTLEMENT</span><strong>${mode === 'AUTO' ? 'AUTO CASHOUT' : mode === 'BOSS_COMPLETE' ? 'BOSS COMPLETE' : 'MANUAL'}</strong></div>
      </div>
      <div class="wallet-after"><span>WALLET BALANCE</span><strong>${money(model.player.balance)}</strong></div>
      <button class="ui-button" data-action="back-menu">BACK TO MENU</button>
    </div></section>`;
}
function runLostScreen() {
  const entry = Number(model.session?.entryAmount || model.selectedEntry || 0);
  return `<section class="screen modal-screen run-lost-screen">${backgrounds('gameplay')}
    <div class="run-lost-vignette"></div>
    <div class="sci-panel run-lost-panel">
      <div class="panel-kicker danger-kicker">RUN TERMINATED</div>
      <h1 class="panel-title">RUN LOST</h1>
      <div class="run-lost-mark">×</div>
      <div class="run-lost-reward"><span>REWARD</span><strong>0</strong><em>COINS</em></div>
      <div class="checkpoint-strip">
        <div><span>FINAL SCORE</span><strong>${money(model.score)}</strong></div>
        <div><span>WAVE REACHED</span><strong>${model.wave}</strong></div>
        <div><span>ENTRY LOST</span><strong>${money(entry)}</strong></div>
      </div>
      <button class="ui-button danger" data-action="back-menu">BACK TO MENU</button>
    </div>
  </section>`;
}
function bossCompleteScreen() {
  const cashout = model.session?.cashout || {};
  const reward = Number(cashout.reward ?? model.session?.reward ?? 0);
  const multiplier = Number(cashout.multiplier ?? model.session?.cashoutMultiplier ?? 0);
  return `<section class="screen modal-screen boss-complete-screen">${backgrounds('gameplay')}${currencyBar()}
    <div class="boss-complete-vfx"><i></i><i></i><i></i><b></b><b></b></div>
    <div class="sci-panel boss-complete-panel">
      <div class="panel-kicker">FINAL BOSS DESTROYED</div>
      <h1 class="panel-title">RUN COMPLETE</h1>
      <img class="boss-complete-art" src="/assets/bosses/FinalBoss_01.png" alt="Final Boss" />
      <div class="boss-complete-reward">
        <span>FINAL SETTLEMENT</span>
        <strong>${money(reward)} COINS</strong>
        <em>${multiplier > 0 ? `x${multiplier.toFixed(2)} BEST UNLOCKED TIER` : 'NO SCORE-GATED TIER UNLOCKED'}</em>
      </div>
      <div class="checkpoint-strip">
        <div><span>FINAL SCORE</span><strong>${money(model.score)}</strong></div>
        <div><span>WAVE</span><strong>10</strong></div>
        <div><span>WALLET</span><strong>${money(model.player.balance)}</strong></div>
      </div>
      <button class="ui-button" data-action="view-result">VIEW RESULT</button>
    </div>
  </section>`;
}
function systemFallbackScreen(state) {
  return `<section class="screen modal-screen system-screen">${backgrounds('gameplay')}
    <div class="sci-panel system-panel">
      <div class="panel-kicker">SYSTEM</div>
      <h1 class="panel-title">RETURN TO MENU</h1>
      <p class="info-copy">This run state is unavailable. Return to the main menu to continue.</p>
      <button class="ui-button" data-action="back-menu">BACK TO MENU</button>
    </div>
  </section>`;
}
function stopGameplayEngine() { if (activeEngine) { activeEngine.stop(); activeEngine = null; } }
function stopCheckpointClock() { if (checkpointClock) { clearInterval(checkpointClock); checkpointClock = null; } }
function render() {
  stopGameplayEngine(); stopCheckpointClock();
  const state = machine.state;
  let html = '';
  if (state === GameState.MENU) html = menuScreen();
  else if ([GameState.ENTRY_SELECTED, GameState.ENTRY_PAID].includes(state)) html = entryScreen();
  else if ([GameState.COUNTDOWN, GameState.WAVE_PLAYING].includes(state)) html = gameplayScreen();
  else if (state === GameState.WAVE_CLEAR) html = waveClearScreen();
  else if (state === GameState.CHECKPOINT) html = checkpointScreen();
  else if (state === GameState.RESULT) html = resultScreen();
  else if (state === GameState.BOSS_COMPLETE) html = bossCompleteScreen();
  else if (state === GameState.RUN_LOST) html = runLostScreen();
  else html = systemFallbackScreen(state);
  app.innerHTML = `<main class="app-shell phase7-shell phase8-shell vfx3-shell" data-state="${state}">${html}${audioSettingsMarkup()}</main>`;
  audioManager.setMusicTrack(musicTrackForState(state));
  queueMicrotask(() => app.querySelector('.screen')?.classList.add('screen-ready'));
  if (state === GameState.WAVE_PLAYING) queueMicrotask(mountGameplayEngine);
  if (state === GameState.CHECKPOINT) queueMicrotask(startCheckpointClock);
}
function startCheckpointClock() {
  stopCheckpointClock();
  const cp = model.checkpoint || model.session?.checkpoint || {};
  const fallbackDeadline = Date.now() + DECISION_SECONDS * 1000;
  const deadline = Date.parse(cp.decisionDeadline || '') || fallbackDeadline;
  const totalMs = Math.max(1000, Number(cp.decisionSeconds || DECISION_SECONDS) * 1000);
  const tick = () => {
    if (machine.state !== GameState.CHECKPOINT) return stopCheckpointClock();
    const remaining = Math.max(0, deadline - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const timer = app.querySelector('[data-checkpoint-timer]');
    const progress = app.querySelector('[data-checkpoint-progress]');
    if (timer) timer.textContent = String(seconds);
    if (progress) progress.style.width = `${Math.max(0, Math.min(100, (remaining / totalMs) * 100))}%`;
    if (remaining <= 0) { stopCheckpointClock(); if (!checkpointDecisionPending) cashOut('auto'); }
  };
  tick(); checkpointClock = setInterval(tick, 100);
}
function updateGameplayHud(snapshot) {
  model.score = Number(snapshot.score ?? model.score);
  model.lives = Number(snapshot.lives ?? model.lives);
  model.wave = Number(snapshot.wave ?? model.wave);
  model.stats = { ...model.stats, ...snapshot, killsByType: { ...(snapshot.killsByType || model.stats.killsByType || {}) }, patternActivations: { ...(snapshot.patternActivations || model.stats.patternActivations || {}) } };
  const set = (sel, value) => { const el = app.querySelector(sel); if (el) el.textContent = value; };
  set('[data-hud-score]', money(model.score)); set('[data-hud-wave]', String(model.wave)); set('[data-hud-lives]', String(model.lives));
  set('[data-stat-accuracy]', `${Number(snapshot.accuracy || 0).toFixed(0)}%`);
  set('[data-stat-combo]', `x${formatMultiplierValue(snapshot.comboMultiplier || 1)}`);
  set('[data-stat-remaining]', String(snapshot.enemiesRemaining ?? model.stats.enemiesRemaining ?? 0));
  set('[data-stat-pattern]', prettyPattern(snapshot.lastPattern || 'FORMATION'));
  const overdrive = app.querySelector('[data-overdrive-label]');
  const overdriveBar = app.querySelector('[data-overdrive-bar]');
  const active = Number(snapshot.overdriveActiveRemaining || 0) > 0;
  if (overdrive) overdrive.textContent = active ? `${Number(snapshot.overdriveActiveRemaining || 0).toFixed(1)}s` : `${Math.round(Number(snapshot.overdriveEnergy || 0))}%`;
  if (overdriveBar) overdriveBar.style.width = `${active ? 100 : Math.max(0, Math.min(100, Number(snapshot.overdriveEnergy || 0)))}%`;
  const tier = bestUnlockedTier(snapshot.wave ?? model.wave, snapshot.score ?? model.score);
  const displayedMultiplier = tier.multiplier > 0 ? tier.multiplier : runStartMultiplier();
  set('[data-current-multiplier]', `x${displayedMultiplier.toFixed(2)}`);
  const tierChip = app.querySelector('.multiplier-chip');
  if (tierChip) {
    tierChip.classList.toggle('unlocked', tier.multiplier > 0);
    tierChip.classList.toggle('starting', tier.multiplier <= 0);
    const tierLabel = tierChip.querySelector('span');
    if (tierLabel) tierLabel.textContent = tier.multiplier > 0 ? 'CASHOUT TIER' : 'START MULTIPLIER';
  }
  applyPolishFeedback(snapshot);
  const bombButton = app.querySelector('[data-action="bomb"]');
  if (bombButton) { const ready = Boolean(snapshot.bombAvailable); bombButton.disabled = !ready; bombButton.classList.toggle('spent', !ready); const label = bombButton.querySelector('span'); if (label) label.textContent = ready ? 'BOMB • 1' : 'BOMB • USED'; }
}
async function persistCoreSnapshot(snapshot) {
  updateGameplayHud(snapshot);
  if (snapshot.waveResult || snapshotBusy || waveClearPending || !model.session?.id || String(model.session.id).startsWith('dev-')) return;
  snapshotBusy = true;
  try {
    const payload = await api.saveCoreState(model.session.id, snapshot);
    model.session = payload.session;
  } catch (error) {
    console.warn('Core-state sync failed:', error.message);
    if (error?.status === 422 && model.session?.id) {
      try {
        const authoritative = await api.getSession(model.session.id);
        applySessionToModel(authoritative.session);
        model.error = 'Gameplay state was rejected by server validation and has been resynced.';
        machine.set(GameState.WAVE_PLAYING, { force: true });
      } catch (recoveryError) {
        console.warn('Authoritative resync failed:', recoveryError.message);
      }
    }
  } finally { snapshotBusy = false; }
}
async function handleRunLost(snapshot) {
  if (runLostPending) return;
  runLostPending = true; waveClearPending = false; updateGameplayHud(snapshot);
  try {
    if (model.session?.id && !String(model.session.id).startsWith('dev-')) {
      const payload = await api.loseSession(model.session.id, snapshot); model.player = payload.player; applySessionToModel(payload.session);
    }
  } catch (error) { console.warn('Run-lost sync failed:', error.message); }
  finally { runLostPending = false; machine.set(GameState.RUN_LOST, { force: true }); }
}
async function handleWaveClear(snapshot) {
  if (waveClearPending) return;
  waveClearPending = true; stopGameplayEngine(); updateGameplayHud(snapshot);
  try {
    if (model.session?.id && !String(model.session.id).startsWith('dev-')) {
      const payload = await api.clearWave(model.session.id, snapshot); applySessionToModel(payload.session); model.lastWaveResult = payload.waveResult; model.checkpoint = payload.checkpoint;
      if (payload.session.state === 'CHECKPOINT') machine.set(GameState.CHECKPOINT, { force: true });
      else if (payload.session.state === 'BOSS_COMPLETE') { if (payload.player) model.player = payload.player; machine.set(GameState.BOSS_COMPLETE, { force: true }); }
      else { machine.set(GameState.WAVE_CLEAR, { force: true }); scheduleAutoAdvance(); }
    } else {
      model.lastWaveResult = snapshot.waveResult; model.score = snapshot.score;
      if ([3, 5, 7, 9].includes(model.wave)) { model.checkpoint = makeDevCheckpoint(model.wave); machine.set(GameState.CHECKPOINT, { force: true }); }
      else { machine.set(GameState.WAVE_CLEAR, { force: true }); scheduleAutoAdvance(); }
    }
    if (Number(snapshot.wave ?? model.wave) < 10 && machine.state !== GameState.BOSS_COMPLETE) {
      audioManager.playSfx('waveClear', { volume: 0.62, rate: 1, throttleMs: 800, poolSize: 2 });
    }
  } catch (error) { model.error = error.message; machine.set(GameState.WAVE_PLAYING, { force: true }); }
  finally { waveClearPending = false; }
}
function mountGameplayEngine() {
  if (machine.state !== GameState.WAVE_PLAYING || activeEngine) return;
  const canvas = app.querySelector('[data-game-canvas]'); if (!canvas) return;
  const core = model.session?.coreState || {};
  activeEngine = new CoreGameplayEngine(canvas, {
    difficulty: model.session?.difficulty || model.selectedDifficulty,
    wave: model.wave,
    initialState: {
      wave: model.wave, score: model.session?.score ?? model.score, lives: model.session?.lives ?? model.lives,
      kills: core.kills ?? model.stats.kills, shotsFired: core.shotsFired ?? model.stats.shotsFired, shotsHit: core.shotsHit ?? model.stats.shotsHit,
      damageTaken: core.damageTaken ?? model.stats.damageTaken, killsByType: core.killsByType ?? model.stats.killsByType,
      patternActivations: core.patternActivations ?? model.stats.patternActivations, lastPattern: core.lastPattern ?? model.stats.lastPattern,
      bombKillsByType: core.bombKillsByType ?? model.stats.bombKillsByType,
      comboIndex: core.comboIndex || 0, comboTimer: core.comboTimer || 0, overdriveEnergy: core.overdriveEnergy || 0, overdriveActiveRemaining: core.overdriveActiveRemaining || 0,
      bombAvailable: core.bombAvailable ?? !core.bombUsed, bombUsed: core.bombUsed || false, waveElapsed: core.waveElapsed || 0,
      waveStart: model.session?.waveState?.startCore || undefined
    },
    seed: model.session?.gameSeed || 'dev-phase-8', sessionId: model.session?.id,
    onHud: updateGameplayHud, onSnapshot: persistCoreSnapshot, onRunLost: handleRunLost, onWaveClear: handleWaveClear, onVfxEvent: handleVfxEvent, onAudioEvent: handleAudioEvent
  });
  resetVisualTelemetry(activeEngine.snapshot?.() || {});
  activeEngine.start();
  window.setTimeout(showWaveIntro, 60);
}
async function refreshPlayer() { const payload = await api.ensurePlayer(PLAYER_ID); model.player = payload.player; model.session = payload.activeSession || null; return payload.activeSession || null; }
function applySessionToModel(session) {
  if (!session) return;
  model.session = session; model.selectedEntry = session.entryAmount || model.selectedEntry; model.selectedDifficulty = session.difficulty || model.selectedDifficulty;
  model.wave = Number(session.wave || 1); model.score = Number(session.score || 0); model.lives = Number(session.lives ?? 3);
  model.stats = { ...emptyStats(), ...(session.coreState || {}) };
  model.stats.accuracy = model.stats.shotsFired > 0 ? (model.stats.shotsHit / model.stats.shotsFired) * 100 : 0;
  model.lastWaveResult = session.waveState?.lastResult || model.lastWaveResult; model.checkpoint = session.checkpoint || null;
}
async function resumeActiveSession(session) {
  if (!session) return false; applySessionToModel(session);
  if (session.state === 'RESULT') { machine.set(GameState.RESULT, { force: true }); return true; }
  if (session.state === 'BOSS_COMPLETE') { machine.set(GameState.BOSS_COMPLETE, { force: true }); return true; }
  if (session.state === 'WAVE_PLAYING') { machine.set(GameState.WAVE_PLAYING, { force: true }); return true; }
  if (session.state === 'WAVE_CLEAR') { machine.set(GameState.WAVE_CLEAR, { force: true }); scheduleAutoAdvance(); return true; }
  if (session.state === 'CHECKPOINT') { machine.set(GameState.CHECKPOINT, { force: true }); return true; }
  if (['ENTRY_PAID', 'COUNTDOWN'].includes(session.state)) {
    if (session.state === 'ENTRY_PAID') { const payload = await api.setCountdown(session.id); applySessionToModel(payload.session); }
    machine.set(GameState.COUNTDOWN, { force: true }); await runCountdown(); return true;
  }
  return false;
}
async function startRun() {
  if (model.busy) return;
  model.selectedEntry = normalizeEntry(model.selectedEntry);
  if (model.player.balance < ENTRY_MIN || model.selectedEntry > model.player.balance) {
    model.error = 'Insufficient coin balance'; render(); return;
  }
  model.busy = true; model.error = ''; render();
  try {
    const payload = await api.startSession({ playerId: PLAYER_ID, entryAmount: model.selectedEntry, difficulty: model.selectedDifficulty });
    audioManager.playSfx('coinSpend', { volume: 0.82, rate: 1, poolSize: 2 });
    model.player = payload.player; applySessionToModel(payload.session); model.stats = emptyStats(); model.lastWaveResult = null; model.checkpoint = null;
    machine.set(GameState.ENTRY_PAID); const countdownPayload = await api.setCountdown(model.session.id); applySessionToModel(countdownPayload.session); machine.set(GameState.COUNTDOWN); await runCountdown();
  } catch (error) { model.error = error.message; machine.set(GameState.ENTRY_SELECTED, { force: true }); }
  finally { model.busy = false; if (machine.state !== GameState.WAVE_PLAYING) render(); }
}
async function runCountdown() {
  for (const count of [3, 2, 1]) { model.countdown = count; render(); await wait(600); }
  model.countdown = null;
  if (model.session?.id && !String(model.session.id).startsWith('dev-')) { const payload = await api.beginSession(model.session.id); applySessionToModel(payload.session); }
  machine.set(GameState.WAVE_PLAYING, { force: true });
}
async function advanceWave() {
  if (!model.session?.id || String(model.session.id).startsWith('dev-')) { model.wave += 1; model.stats.waveElapsed = 0; machine.set(GameState.WAVE_PLAYING, { force: true }); return; }
  try { const payload = await api.nextWave(model.session.id); applySessionToModel(payload.session); model.lastWaveResult = null; machine.set(GameState.WAVE_PLAYING, { force: true }); }
  catch (error) { setError(error.message); }
}
async function continueCheckpoint() {
  if (checkpointDecisionPending) return;
  checkpointDecisionPending = true; stopCheckpointClock(); model.error = ''; render();
  try {
    if (!model.session?.id || String(model.session.id).startsWith('dev-')) {
      if (model.wave >= 10) throw new Error('Run is already at the Final Boss');
      model.wave += 1; model.checkpoint = null; model.lastWaveResult = null; checkpointDecisionPending = false; machine.set(GameState.WAVE_PLAYING, { force: true }); return;
    }
    const payload = await api.checkpointDecision(model.session.id, 'continue');
    if (payload.player) model.player = payload.player;
    applySessionToModel(payload.session);
    checkpointDecisionPending = false;
    if (payload.session.state === 'RESULT') machine.set(GameState.RESULT, { force: true });
    else { model.lastWaveResult = null; machine.set(GameState.WAVE_PLAYING, { force: true }); }
  } catch (error) { checkpointDecisionPending = false; model.error = error.message; render(); }
}
async function cashOut(mode = 'manual') {
  if (checkpointDecisionPending) return;
  checkpointDecisionPending = true; stopCheckpointClock(); model.error = ''; render();
  try {
    if (!model.session?.id || String(model.session.id).startsWith('dev-')) {
      const cp = model.checkpoint || makeDevCheckpoint(model.wave);
      const floorMultiplier = runStartMultiplier();
      const settlementMultiplier = Number(cp.bestUnlockedMultiplier || floorMultiplier);
      const reward = Number(cp.currentReward ?? Math.round(model.selectedEntry * settlementMultiplier));
      model.player.balance += reward;
      model.session = { ...(model.session || {}), state: 'RESULT', reward, cashoutMultiplier: settlementMultiplier, cashout: { wave: model.wave, multiplier: settlementMultiplier, reward, entryAmount: model.selectedEntry, netProfit: reward - model.selectedEntry, mode, score: model.score, payoutSource: cp.bestUnlockedWave ? 'checkpoint' : 'start' } };
      model.checkpoint = null; checkpointDecisionPending = false; machine.set(GameState.RESULT, { force: true }); return;
    }
    const payload = await api.checkpointDecision(model.session.id, mode === 'auto' ? 'auto' : 'cashout');
    if (payload.player) model.player = payload.player;
    applySessionToModel(payload.session);
    checkpointDecisionPending = false; machine.set(GameState.RESULT, { force: true });
  } catch (error) { checkpointDecisionPending = false; model.error = `${mode === 'auto' ? 'Auto cashout failed: ' : ''}${error.message}`; render(); }
}
function scheduleAutoAdvance() {
  const token = ++autoAdvanceToken;
  setTimeout(async () => { if (token !== autoAdvanceToken || machine.state !== GameState.WAVE_CLEAR) return; await advanceWave(); }, 1450);
}
async function abandonRun() {
  ++autoAdvanceToken; stopGameplayEngine(); stopCheckpointClock();
  try {
    if (model.session?.id && !String(model.session.id).startsWith('dev-')) { const payload = await api.abandonSession(model.session.id); model.player = payload.player; applySessionToModel(payload.session); }
    machine.set(GameState.RUN_LOST, { force: true });
  } catch (error) { setError(error.message); }
}
async function backToMenu() {
  stopCheckpointClock(); ++autoAdvanceToken;
  try {
    if ([GameState.RESULT, GameState.BOSS_COMPLETE].includes(machine.state) && model.session?.id && !String(model.session.id).startsWith('dev-')) {
      const payload = await api.closeSession(model.session.id); if (payload.player) model.player = payload.player;
    }
  } catch (error) { console.warn('Session close failed:', error.message); }
  model.session = null; model.checkpoint = null; model.lastWaveResult = null; model.error = ''; checkpointDecisionPending = false;
  machine.set(GameState.MENU, { force: true });
}
function makeDevCheckpoint(wave) {
  const difficulty = model.selectedDifficulty;
  const gate = checkpointScoreGate(wave, difficulty);
  const multiplier = checkpointMultiplier(wave, difficulty);
  const unlocked = model.score >= gate;
  let bestMultiplier = runStartMultiplier(difficulty);
  let bestUnlockedWave = null;
  for (const checkpointWave of CASHOUT_WAVES) {
    if (checkpointWave > wave) break;
    if (model.score >= checkpointScoreGate(checkpointWave, difficulty)) {
      bestMultiplier = checkpointMultiplier(checkpointWave, difficulty);
      bestUnlockedWave = checkpointWave;
    }
  }
  const next = nextCheckpointAfter(wave, difficulty) || {};
  return {
    wave, scoreGate: gate, multiplier, scoreUnlocked: unlocked, bestUnlockedWave, bestUnlockedMultiplier: bestMultiplier,
    payoutSource: bestUnlockedWave ? 'checkpoint' : 'start', startMultiplier: runStartMultiplier(difficulty),
    currentReward: Math.round(model.selectedEntry * bestMultiplier), potentialReward: Math.round(model.selectedEntry * multiplier),
    nextCheckpointWave: next.wave, nextScoreGate: next.scoreGate, nextMultiplier: next.multiplier,
    nextReward: next.multiplier ? Math.round(model.selectedEntry * next.multiplier) : null,
    decisionSeconds: DECISION_SECONDS, decisionDeadline: new Date(Date.now() + DECISION_SECONDS * 1000).toISOString(), canContinue: wave < 10
  };
}
function devPreviewFromQuery() {
  const params = new URLSearchParams(location.search); const q = params.get('screen'); if (!q) return false;
  const wave = Math.max(1, Math.min(10, Number(params.get('wave') || 1))); model.wave = wave;
  const previewGateWave = [...CASHOUT_WAVES].reverse().find((candidate) => candidate <= wave);
  const previewDefaultScore = previewGateWave ? checkpointScoreGate(previewGateWave, model.selectedDifficulty) + 5000 : 0;
  model.score = Number(params.get('score') || previewDefaultScore);
  const map = { menu: GameState.MENU, entry: GameState.ENTRY_SELECTED, gameplay: GameState.WAVE_PLAYING, clear: GameState.WAVE_CLEAR, checkpoint: GameState.CHECKPOINT, result: GameState.RESULT, lost: GameState.RUN_LOST, boss: GameState.BOSS_COMPLETE };
  const state = map[q.toLowerCase()]; if (!state) return false;
  model.session = { id: 'dev-preview', difficulty: model.selectedDifficulty, entryAmount: model.selectedEntry, score: model.score, lives: 3, gameSeed: 'dev-phase-8', wave, coreState: { ...emptyStats() }, waveState: { startCore: { score: 0, kills: 0, shotsFired: 0, shotsHit: 0, damageTaken: 0 }, lastResult: model.lastWaveResult } };
  if (state === GameState.CHECKPOINT) { model.checkpoint = makeDevCheckpoint(wave); model.session.checkpoint = model.checkpoint; }
  if (state === GameState.BOSS_COMPLETE) {
    const multiplier = Number(params.get('multiplier') || checkpointMultiplier(10, model.selectedDifficulty)); const reward = Math.round(model.selectedEntry * multiplier);
    model.player.balance = 5000 - model.selectedEntry + reward; model.session.cashout = { wave: 10, multiplier, reward, entryAmount: model.selectedEntry, netProfit: reward - model.selectedEntry, mode: 'boss_complete', score: model.score }; model.session.reward = reward; model.session.state = 'BOSS_COMPLETE';
  }
  if (state === GameState.RESULT) {
    const multiplier = Number(params.get('multiplier') || checkpointMultiplier(wave, model.selectedDifficulty) || runStartMultiplier(model.selectedDifficulty)); const reward = Math.round(model.selectedEntry * multiplier);
    model.player.balance = 5000 - model.selectedEntry + reward;
    model.session.cashout = { wave, multiplier, reward, entryAmount: model.selectedEntry, netProfit: reward - model.selectedEntry, mode: params.get('mode') || 'manual', score: model.score };
    model.session.reward = reward; model.session.state = 'RESULT';
  }
  machine.set(state, { force: true }); return true;
}

app.addEventListener('click', async (event) => {
  audioManager.unlock();
  const audioAction = event.target.closest('[data-action]')?.dataset.action;
  if (audioAction === 'audio-settings-open') { openAudioSettings(); return; }
  if (audioAction === 'audio-settings-close') { closeAudioSettings(); return; }
  if (audioAction === 'audio-mute') { audioManager.toggleMute(); syncAudioSettingsUi(); return; }
  if (event.target.matches('[data-audio-settings-overlay]')) { closeAudioSettings(); return; }
  const diffButton = event.target.closest('[data-difficulty]'); if (diffButton) { model.selectedDifficulty = diffButton.dataset.difficulty; model.error = ''; render(); return; }
  const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
  if (action === 'entry-minus') { model.selectedEntry = normalizeEntry(model.selectedEntry - ENTRY_STEP); model.error = ''; render(); return; }
  if (action === 'entry-plus') { model.selectedEntry = normalizeEntry(model.selectedEntry + ENTRY_STEP); model.error = ''; render(); return; }
  if (action === 'play') { model.error = ''; model.selectedEntry = normalizeEntry(model.selectedEntry); machine.set(GameState.ENTRY_SELECTED); }
  else if (action === 'back-menu') await backToMenu();
  else if (action === 'start-run') await startRun();
  else if (action === 'abandon') await abandonRun();
  else if (action === 'continue-wave') await continueCheckpoint();
  else if (action === 'cashout') await cashOut('manual');
  else if (action === 'bomb') {
    const bombButton = event.target.closest('[data-action="bomb"]');
    const requiresDoubleTap = bombButton?.dataset.bombDoubleTap === 'true';
    if (requiresDoubleTap) {
      const now = performance.now();
      const isSecondTap = bombDoubleTapTarget === bombButton && (now - bombDoubleTapAt) <= BOMB_DOUBLE_TAP_WINDOW_MS;
      if (!isSecondTap) {
        bombDoubleTapAt = now;
        bombDoubleTapTarget = bombButton;
        bombButton.classList.add('doubletap-armed');
        window.setTimeout(() => {
          if (bombDoubleTapTarget === bombButton && performance.now() - bombDoubleTapAt >= BOMB_DOUBLE_TAP_WINDOW_MS - 12) {
            bombDoubleTapAt = 0;
            bombDoubleTapTarget = null;
            if (bombButton.isConnected) bombButton.classList.remove('doubletap-armed');
          }
        }, BOMB_DOUBLE_TAP_WINDOW_MS);
        return;
      }
      bombDoubleTapAt = 0;
      bombDoubleTapTarget = null;
      bombButton.classList.remove('doubletap-armed');
    }
    activeEngine?.useBomb();
  }
  else if (action === 'view-result') machine.set(GameState.RESULT, { force: true });
});

app.addEventListener('input', (event) => {
  const musicSlider = event.target.closest('[data-audio-music-volume]');
  if (musicSlider) {
    audioManager.unlock();
    audioManager.setMusicVolume(Number(musicSlider.value) / 100);
    const label = app.querySelector('[data-music-volume-label]');
    if (label) label.textContent = `${Math.round(Number(musicSlider.value))}%`;
    return;
  }
  const sfxSlider = event.target.closest('[data-audio-sfx-volume]');
  if (sfxSlider) {
    audioManager.unlock();
    audioManager.setSfxVolume(Number(sfxSlider.value) / 100);
    const label = app.querySelector('[data-sfx-volume-label]');
    if (label) label.textContent = `${Math.round(Number(sfxSlider.value))}%`;
    return;
  }
  const input = event.target.closest('[data-entry-input]');
  if (!input) return;
  const raw = Number(input.value);
  if (!Number.isFinite(raw)) return;
  model.selectedEntry = raw;
  const summary = app.querySelector('[data-entry-summary]');
  if (summary) summary.textContent = money(raw);
  const startButton = app.querySelector('[data-action="start-run"]');
  const valid = raw >= ENTRY_MIN && raw <= model.player.balance && raw <= ENTRY_MAX && raw % ENTRY_STEP === 0;
  if (startButton && !model.busy) {
    startButton.disabled = !valid;
    startButton.textContent = valid ? `START RUN • ${money(raw)}` : (raw > model.player.balance ? 'INSUFFICIENT COINS' : `USE ${ENTRY_STEP}-COIN STEPS`);
  }
});
app.addEventListener('change', (event) => {
  const input = event.target.closest('[data-entry-input]');
  if (!input) return;
  model.selectedEntry = normalizeEntry(input.value);
  model.error = '';
  render();
});

window.addEventListener('pointerdown', () => audioManager.unlock(), { once: true, passive: true });
window.addEventListener('keydown', () => audioManager.unlock(), { once: true });

machine.subscribe((state) => {
  render();
  syncRouteToState(state);
});

window.addEventListener('popstate', () => {
  const route = routeKindFromLocation();
  const runIsOpen = Boolean(model.session?.id) && ![GameState.RESULT, GameState.RUN_LOST, GameState.BOSS_COMPLETE].includes(machine.state);

  if (route === 'entry') {
    if (runIsOpen) return syncRouteToState(machine.state, { replace: true });
    machine.set(GameState.ENTRY_SELECTED, { force: true });
    return;
  }
  if (route === 'gameplay') {
    if (model.session?.id) return syncRouteToState(machine.state, { replace: true });
    model.error = 'No active run. Start a run first.';
    machine.set(GameState.MENU, { force: true });
    return;
  }
  if (route === 'menu') {
    if (runIsOpen) return syncRouteToState(machine.state, { replace: true });
    machine.set(GameState.MENU, { force: true });
    return;
  }
  window.history.replaceState({ galagaRoute: true }, '', ROUTE_PATHS.menu);
  machine.set(GameState.MENU, { force: true });
});

(async function boot() {
  showLoadingScreen();

  // Warm the backend in parallel with asset loading so a Render cold start does not
  // unnecessarily extend the startup sequence after the asset cache reaches 100%.
  const playerRequest = refreshPlayer()
    .then((activeSession) => ({ ok: true, activeSession }))
    .catch((error) => ({ ok: false, error }));

  const preloadSummary = await preloadAssets(STARTUP_ASSETS, {
    onProgress: ({ completed, total }) => {
      const percent = total ? (completed / total) * 100 : 100;
      const status = completed >= total ? 'Loading....' : 'Loading....';
      updateLoadingProgress(percent, completed, total, status);
    }
  });

  if (preloadSummary.failed.length) {
    console.warn('Startup assets unavailable:', preloadSummary.failed);
  }

  updateLoadingProgress(100, preloadSummary.total, preloadSummary.total, 'Loading....');
  const playerResult = await playerRequest;

  // Advanced boss/audio files are intentionally non-blocking and continue warming
  // the browser cache once the first screen is visible.
  preloadDeferredAssets();

  if (playerResult.ok) {
    const activeSession = playerResult.activeSession;
    if (devPreviewFromQuery()) return;

    // Existing server-authoritative runs always resume into /gameplay.
    const resumed = await resumeActiveSession(activeSession);
    if (resumed) return;

    if (initialRouteKind === 'entry') {
      machine.set(GameState.ENTRY_SELECTED, { force: true });
      return;
    }
    if (initialRouteKind === 'gameplay') {
      model.error = 'No active run. Start a run first.';
      machine.set(GameState.MENU, { force: true });
      return;
    }
    machine.set(GameState.MENU, { force: true });
    return;
  }

  model.error = `Backend unavailable: ${playerResult.error?.message || 'Unknown error'}`;
  if (devPreviewFromQuery()) return;
  if (initialRouteKind === 'entry') machine.set(GameState.ENTRY_SELECTED, { force: true });
  else machine.set(GameState.MENU, { force: true });
})();
