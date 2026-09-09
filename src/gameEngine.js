import { PatternDirector, PATTERNS } from './patternDirector.js';
import { createGameplayImageView } from './assetCache.js';
import { SCORE_VALUES, accuracyBonusRate, comboStepsForDifficulty, comboWindowForDifficulty, waveDefinition } from './waveConfig.js';

const CORE_STATE_SYNC_INTERVAL_SECONDS = 4;

const DANGEROUS_ROUTE_TELEGRAPHS = new Set(['dive', 'charge', 'pincer', 'spiral', 'eliteAssault']);
const UNDER_BULLET_EFFECTS = new Set(['energyCloud', 'explosion', 'secondaryBurst', 'deathRing', 'coreFlash']);
const RECOVERY_AFTER_ATTACK = Object.freeze({ pincer: 0.30, charge: 0.34, crossfire: 0.30, eliteAssault: 0.38 });



const ENEMY = Object.freeze({
  // Class identity stays stable across difficulties; HP scaling is applied by
  // combatHpForDifficulty() so Easy/Medium/Hard feel materially different.
  fighter: { score: 100, hitScaleX: 0.58, hitScaleY: 0.54, size: 1.0, hp: 1, role: 'line', driftX: 0.026, driftY: 0.007, driftSpeed: 1.00 },
  diver: { score: 150, hitScaleX: 0.56, hitScaleY: 0.52, size: 1.03, hp: 1, role: 'dive', driftX: 0.038, driftY: 0.011, driftSpeed: 1.08 },
  shooter: { score: 200, hitScaleX: 0.60, hitScaleY: 0.56, size: 1.06, hp: 1, role: 'ranged', driftX: 0.017, driftY: 0.005, driftSpeed: 0.82 },
  heavy: { score: 300, hitScaleX: 0.64, hitScaleY: 0.58, size: 1.16, hp: 3, role: 'anchor', driftX: 0.011, driftY: 0.004, driftSpeed: 0.64 },
  charger: { score: 300, hitScaleX: 0.56, hitScaleY: 0.55, size: 1.08, hp: 2, role: 'flanker', driftX: 0.023, driftY: 0.008, driftSpeed: 0.95 },
  elite: { score: 500, hitScaleX: 0.62, hitScaleY: 0.57, size: 1.18, hp: 4, role: 'ace', driftX: 0.034, driftY: 0.011, driftSpeed: 1.12 },
  miniBoss: { score: 1000, hitScaleX: 0.62, hitScaleY: 0.58, size: 2.05, hp: 110, role: 'boss' },
  finalBoss: { score: 5000, hitScaleX: 0.63, hitScaleY: 0.60, size: 2.42, hp: 220, role: 'boss' }
});

// Difficulty Combat Rebuild — HP identity.
// Patch 7 shifts the durability ladder upward: line ships now take 2 / 3 / 4
// player shots on Easy / Medium / Hard, while specialists retain extra durability.
export const DIFFICULTY_ENEMY_HP = Object.freeze({
  // Patch 7: the whole ladder is intentionally shifted upward.
  // EASY = Medium+, MEDIUM = Hard, HARD = Extreme.
  easy: Object.freeze({ fighter: 2, diver: 2, shooter: 2, charger: 3, heavy: 4, elite: 5, miniBoss: 120, finalBoss: 250 }),
  medium: Object.freeze({ fighter: 3, diver: 3, shooter: 3, charger: 4, heavy: 5, elite: 6, miniBoss: 180, finalBoss: 360 }),
  hard: Object.freeze({ fighter: 4, diver: 4, shooter: 4, charger: 5, heavy: 7, elite: 8, miniBoss: 260, finalBoss: 520 })
});

export function combatHpForDifficulty(type, difficulty = 'medium') {
  const table = DIFFICULTY_ENEMY_HP[String(difficulty || '').toLowerCase()] || DIFFICULTY_ENEMY_HP.medium;
  return Math.max(1, Number(table[type] ?? ENEMY[type]?.hp ?? ENEMY.fighter.hp));
}

const TUNING = {
  // Patch 7 combat ladder: player movement stays identical. Difficulty comes
  // from enemy speed, cadence, coordination and shorter reaction windows.
  easy: {
    playerSpeed: 0.70,
    enemyBulletSpeed: 0.47,
    enemyFireInterval: 1.05,
    formationSpeed: 1.00,
    autoFireInterval: 0.21,
    attackSpeed: 1.12,
    shooterChargeChance: 0.35,
    telegraphScale: 0.94
  },
  medium: {
    playerSpeed: 0.70,
    enemyBulletSpeed: 0.57,
    enemyFireInterval: 0.75,
    formationSpeed: 1.17,
    autoFireInterval: 0.21,
    attackSpeed: 1.34,
    shooterChargeChance: 0.52,
    telegraphScale: 0.78
  },
  hard: {
    playerSpeed: 0.70,
    enemyBulletSpeed: 0.68,
    enemyFireInterval: 0.55,
    formationSpeed: 1.35,
    autoFireInterval: 0.21,
    attackSpeed: 1.58,
    shooterChargeChance: 0.68,
    telegraphScale: 0.66
  }
};

function makeFormation(waveDef = {}, { portrait = false } = {}) {
  if (Array.isArray(waveDef.formation) && waveDef.formation.length) {
    return waveDef.formation.map((slot, index) => {
      const rawX = Number(slot.x ?? 0.5);
      const rawY = Number(slot.y ?? 0.2);
      const x = portrait
        ? clamp(0.5 + (rawX - 0.5) * 1.12, 0.05, 0.95)
        : clamp(rawX, 0.05, 0.95);
      const landscapeYScale = Number(waveDef.id || 1) >= 8 ? 1.55 : Number(waveDef.id || 1) >= 6 ? 1.32 : 1.28;
      const yScale = portrait ? 1.25 : landscapeYScale;
      const y = clamp(0.1 + (rawY - 0.1) * yScale, 0.08, portrait ? 0.64 : 0.68);
      return {
        type: slot.type || 'fighter',
        x,
        y,
        group: slot.group || '',
        lane: slot.lane || '',
        order: Number.isFinite(Number(slot.order)) ? Number(slot.order) : index
      };
    });
  }

  // Safe fallback for debug/custom waves that do not provide a authored template.
  const mix = waveDef.mix || {};
  const regularTypes = [];
  for (const type of ['fighter', 'diver', 'shooter', 'heavy', 'charger', 'elite']) {
    for (let i = 0; i < Number(mix[type] || 0); i += 1) regularTypes.push(type);
  }
  const slots = [];
  const columns = Math.min(7, Math.max(4, Math.ceil(Math.sqrt(Math.max(1, regularTypes.length) * 1.8))));
  const hasBoss = Number(mix.miniBoss || 0) > 0 || Number(mix.finalBoss || 0) > 0;
  const baseY = hasBoss ? 0.32 : 0.16;
  regularTypes.forEach((type, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const rowCount = Math.min(columns, regularTypes.length - row * columns);
    const spacing = 0.68 / Math.max(1, rowCount - 1);
    const startX = rowCount === 1 ? 0.5 : 0.16;
    slots.push({ type, x: rowCount === 1 ? 0.5 : startX + col * spacing, y: baseY + row * 0.095, group: '', lane: '', order: index });
  });
  if (Number(mix.miniBoss || 0) > 0) slots.unshift({ type: 'miniBoss', x: 0.5, y: 0.16, group: '', lane: 'boss', order: 0 });
  if (Number(mix.finalBoss || 0) > 0) slots.unshift({ type: 'finalBoss', x: 0.5, y: 0.17, group: '', lane: 'boss', order: 0 });
  return slots;
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOutSine = (t) => -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
const cubicBezier = (p0, p1, p2, p3, t) => {
  const u = 1 - clamp(t, 0, 1);
  const tt = t * t;
  const uu = u * u;
  return uu * u * p0 + 3 * uu * t * p1 + 3 * u * tt * p2 + tt * t * p3;
};

// Dive Route Rebuild: a deterministic two-arc swoop. The target is frozen at
// launch time, the ship passes beside that lane (never homes), then the second
// arc ends exactly on its authored formation slot so there is no return snap.
export function diveRoutePoint(attack = {}, progress = 0) {
  const t = clamp(Number(progress || 0), 0, 1);
  const side = Number(attack.side || 1) < 0 ? -1 : 1;
  const startX = Number(attack.startX ?? 0.5);
  const startY = Number(attack.startY ?? 0.2);
  const returnX = Number(attack.returnX ?? startX);
  const returnY = Number(attack.returnY ?? startY);
  const targetX = clamp(Number(attack.targetX ?? 0.5), 0.10, 0.90);
  const targetY = clamp(Number(attack.targetY ?? 0.865), 0.68, 0.90);

  // Pass near the player's snapshotted lane instead of through its center.
  // Mirrored side offsets keep left/right dives readable and fair.
  const passX = clamp(targetX + side * 0.055, 0.075, 0.925);
  const passY = clamp(targetY - 0.085, 0.70, 0.80);
  const outboundEnd = 0.58;

  if (t <= outboundEnd) {
    const q = t / outboundEnd;
    return {
      x: clamp(cubicBezier(
        startX,
        clamp(startX + side * 0.115, 0.035, 0.965),
        clamp(passX - side * 0.145, 0.055, 0.945),
        passX,
        q
      ), 0.035, 0.965),
      y: cubicBezier(
        startY,
        Math.min(passY - 0.18, startY + 0.14),
        passY - 0.10,
        passY,
        q
      )
    };
  }

  const q = (t - outboundEnd) / (1 - outboundEnd);
  return {
    x: clamp(cubicBezier(
      passX,
      clamp(passX + side * 0.205, 0.035, 0.965),
      clamp(returnX + side * 0.095, 0.035, 0.965),
      returnX,
      q
    ), 0.035, 0.965),
    y: cubicBezier(
      passY,
      passY - 0.055,
      returnY + 0.13,
      returnY,
      q
    )
  };
}

const ENEMY_VFX = Object.freeze({
  fighter: { glow: '#8eeaff', burst: '#65dfff', spark: '#d9fbff' },
  diver: { glow: '#b68cff', burst: '#9f6dff', spark: '#eadcff' },
  shooter: { glow: '#ff944f', burst: '#ff7b3d', spark: '#ffe0ba' },
  heavy: { glow: '#ffd06b', burst: '#ffb431', spark: '#fff1b5' },
  charger: { glow: '#ff6f5f', burst: '#ff4e39', spark: '#ffd0c6' },
  elite: { glow: '#ff67d7', burst: '#e94cff', spark: '#ffd8fb' },
  miniBoss: { glow: '#ffb564', burst: '#ff8357', spark: '#fff0c4' },
  finalBoss: { glow: '#ff5f8f', burst: '#ff3f74', spark: '#ffe0eb' }
});
const PROJECTILE_VFX = Object.freeze({
  shooterCharged: { color: '#ffb05f', length: 0.078, width: 0.011, glow: 20, scale: 1.08 },
  eliteSpecial: { color: '#ff6fd7', length: 0.082, width: 0.011, glow: 22, scale: 1.10 },
  miniBossBullet: { color: '#ff9a66', length: 0.072, width: 0.010, glow: 18, scale: 1.08 },
  miniBossSpread: { color: '#ffb76d', length: 0.078, width: 0.011, glow: 20, scale: 1.12 },
  miniBossTripleBullet: { color: '#ff9b66', length: 0.084, width: 0.010, glow: 21, scale: 1.04 },
  miniBossArcBullet: { color: '#ff8f5b', length: 0.076, width: 0.011, glow: 18, scale: 1.14 },
  miniBossAlternatingBullet: { color: '#ffb264', length: 0.080, width: 0.011, glow: 20, scale: 1.08 },
  miniBossHeavyProjectile: { color: '#ffc57a', length: 0.095, width: 0.014, glow: 24, scale: 1.30 },
  finalBossBullet: { color: '#ff8aa0', length: 0.078, width: 0.011, glow: 18, scale: 1.10 },
  finalBossSpread: { color: '#ff7f95', length: 0.088, width: 0.012, glow: 21, scale: 1.16 }
});

const DANGER_KILL_BONUS_RATE = 0.25;
const LAST_STAND_THRESHOLD = 0.25;

const intersects = (a, b) => (
  Math.abs(a.x - b.x) * 2 < (a.w + b.w) &&
  Math.abs(a.y - b.y) * 2 < (a.h + b.h)
);

function canDraw(image) {
  return Boolean(image && image.complete && image.naturalWidth > 0);
}

function isTouchPrimary() {
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

function isPortraitMobile() {
  const portrait = window.matchMedia?.('(orientation: portrait)')?.matches ?? (window.innerHeight >= window.innerWidth);
  const shortSide = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  return isTouchPrimary() && portrait && shortSide > 0 && shortSide <= 1024;
}

// Patch 1 — Safari mobile render profile. iPadOS may report itself as macOS,
// so maxTouchPoints is included in the iOS detection. The browser exclusion
// keeps this profile scoped to Safari instead of changing Android/desktop Chrome.
function isSafariMobile() {
  const ua = String(navigator.userAgent || '');
  const platform = String(navigator.platform || '');
  const iosDevice = /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!iosDevice || !/WebKit/i.test(ua) || !isTouchPrimary()) return false;
  return !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA)/i.test(ua);
}

function hashSeed(value) {
  let hash = 2166136261;
  const text = String(value || 'phase-8');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seedValue) {
  let state = hashSeed(seedValue) || 0x9e3779b9;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CoreGameplayEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    const safariMobileHint = isSafariMobile();
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: safariMobileHint });
    this.difficulty = options.difficulty || 'medium';
    this.tuning = TUNING[this.difficulty] || TUNING.medium;
    this.onHud = options.onHud || (() => {});
    this.onSnapshot = options.onSnapshot || (() => {});
    this.onRunLost = options.onRunLost || (() => {});
    this.onPattern = options.onPattern || (() => {});
    this.onWaveClear = options.onWaveClear || (() => {});
    this.onVfxEvent = options.onVfxEvent || (() => {});
    this.onAudioEvent = options.onAudioEvent || (() => {});
    this.currentWave = Math.max(1, Number(options.wave || options.initialState?.wave || 1));
    this.waveDef = waveDefinition(this.currentWave, this.difficulty);

    this.random = makeRandom(`${options.seed || options.sessionId || 'phase-8-preview'}:wave:${this.currentWave}`);
    // Patch 4: lazy getters backed by one shared cache; constructor allocates zero sprite Images.
    this.images = createGameplayImageView();
    this.touchMode = isTouchPrimary();
    this.mobilePortrait = isPortraitMobile();
    this.safariMobile = safariMobileHint;
    this.safariPortrait = this.safariMobile && this.mobilePortrait;
    this.targetFrameMs = 1000 / 60;
    this.frameAccumulatorMs = 0;

    // Patch 2 — mobile input + adaptive presentation budget. Pointer events only
    // enqueue the latest X coordinate; gameplay consumes it once per rendered frame.
    // This avoids a layout read + player mutation for every Safari pointermove event.
    this.canvasRect = null;
    this.pendingPointerClientX = null;
    this.pendingPointerId = null;

    // Presentation-only adaptive VFX. Levels: 0 = Patch-1 quality, 1 = balanced,
    // 2 = low-cost. It never changes simulation speed, collision, fire rate or AI.
    // Safari portrait starts on the low-cost presentation tier immediately;
    // other browsers keep the existing adaptive behavior.
    this.adaptiveVfxLevel = this.safariPortrait ? 2 : 0;
    this.renderFrameEmaMs = this.targetFrameMs;
    this.lastRenderSampleTime = 0;
    this.slowRenderMs = 0;
    this.fastRenderMs = 0;

    // Patch 2 — Safari frame-stability guard. Start at 60 FPS and only lock
    // presentation to 30 FPS after Safari proves it cannot sustain the 60 FPS
    // render budget. Simulation/input continue stepping at 60 Hz.
    this.safariStable30 = false;
    this.safariSlowLockMs = 0;
    this.lastDrawTime = 0;
    // Patch 4 — Safari uses a real-time 60 Hz presentation buffer instead of
    // the old one-way 30 FPS fallback. This absorbs 120 Hz rAF callbacks and
    // small WebKit timestamp jitter without skipping visible 60 Hz frames.
    this.safariFrameBufferMs = 0;
    this.hudDirty = false;
    this.hudFlushClock = 0;
    // Patch 7 — sustained Safari combat profile. The cache stores a small
    // pre-rotated copy of formation sprites so WebKit does not execute a
    // translate/rotate/restore stack for every stationary enemy every frame.
    this.safariHalfTurnSpriteCache = new WeakMap();
    this.running = false;
    this.raf = 0;
    this.lastTime = 0;
    this.elapsed = 0;
    this.snapshotClock = 0;
    this.enemyFireClock = 0.75;
    this.fireCycle = 0;
    this.swarmGroupCursor = 0;
    this.playerFireClock = 0;
    this.formationRespawnClock = 0;
    this.waveClearClock = 0;
    this.waveClearPending = false;
    this.waveClearSent = false;
    this.waveElapsed = Math.max(0, Number(options.initialState?.waveElapsed || 0));
    this.enraged = false;
    this.lastStandActive = Boolean(options.initialState?.lastStandActive);
    this.recoveryTimer = Math.max(0, Number(options.initialState?.recoveryTimer || 0));
    this.comboSteps = comboStepsForDifficulty(this.difficulty);
    this.comboWindow = comboWindowForDifficulty(this.difficulty);
    this.comboIndex = Math.max(0, Math.min(this.comboSteps.length - 1, Number(options.initialState?.comboIndex || 0)));
    this.comboTimer = Math.max(0, Math.min(this.comboWindow, Number(options.initialState?.comboTimer || 0)));
    this.runLostSent = false;
    this.pointerId = null;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
    this.patternBanner = { label: 'FORMATION', timer: 1.8 };
    this.visualShake = { strength: 0, timer: 0, duration: 0 };
    this.visualFreezeTimer = 0;
    this.overdriveBurstTimer = 0;
    this.bossPhaseBurstTimer = 0;
    // VFX Patch 3: presentation-only timers for wave entry and boss laser fire.
    this.waveStartFxTimer = this.waveElapsed < 1.5 ? 1.25 : 0;
    this.bossLaserFireFlashTimer = 0;
    this.vfxRandom = makeRandom(`${options.seed || options.sessionId || 'phase-8-preview'}:vfx:wave:${this.currentWave}`);
    this.ambientParticles = Array.from({ length: this.reducedMotion ? 24 : (this.safariPortrait ? 16 : (this.mobilePortrait ? 28 : 58)) }, (_, index) => ({
      x: this.vfxRandom(), y: this.vfxRandom(), size: 0.35 + this.vfxRandom() * 1.4,
      speed: 0.006 + this.vfxRandom() * 0.018, alpha: 0.16 + this.vfxRandom() * 0.42,
      drift: (this.vfxRandom() - 0.5) * 0.012, layer: index % 3
    }));

    this.keys = new Set();
    this.player = {
      x: 0.5,
      y: 0.865,
      lives: clamp(Number(options.initialState?.lives ?? 3), 0, 3),
      respawnTimer: 0,
      invulnerabilityTimer: 0
    };
    this.playerVfx = {
      lastX: this.player.x,
      visualVx: 0,
      tilt: 0,
      recoilTimer: 0,
      muzzleTimer: 0,
      hitTimer: 0,
      hitX: this.player.x,
      hitY: this.player.y,
      thrusterClock: 0,
      trailClock: 0,
      trailPoints: []
    };
    this.thrusterParticles = [];
    this.score = Math.max(0, Number(options.initialState?.score || 0));
    this.stats = {
      kills: Math.max(0, Number(options.initialState?.kills || 0)),
      shotsFired: Math.max(0, Number(options.initialState?.shotsFired || 0)),
      shotsHit: Math.max(0, Number(options.initialState?.shotsHit || 0)),
      damageTaken: Math.max(0, Number(options.initialState?.damageTaken || 0)),
      killsByType: {
        fighter: Math.max(0, Number(options.initialState?.killsByType?.fighter || 0)),
        diver: Math.max(0, Number(options.initialState?.killsByType?.diver || 0)),
        shooter: Math.max(0, Number(options.initialState?.killsByType?.shooter || 0)),
        heavy: Math.max(0, Number(options.initialState?.killsByType?.heavy || 0)),
        charger: Math.max(0, Number(options.initialState?.killsByType?.charger || 0)),
        elite: Math.max(0, Number(options.initialState?.killsByType?.elite || 0))
      },
      dangerKillsByType: Object.fromEntries(Object.keys(ENEMY).map((type) => [type, Math.max(0, Number(options.initialState?.dangerKillsByType?.[type] || 0))]))
    };
    this.stats.killsByType.miniBoss = Math.max(0, Number(options.initialState?.killsByType?.miniBoss || 0));
    this.stats.killsByType.finalBoss = Math.max(0, Number(options.initialState?.killsByType?.finalBoss || 0));
    this.stats.bombKillsByType = Object.fromEntries(Object.keys(ENEMY).map((type) => [type, Math.max(0, Number(options.initialState?.bombKillsByType?.[type] || 0))]));
    this.overdriveEnergy = clamp(Number(options.initialState?.overdriveEnergy || 0), 0, 100);
    this.overdriveTimer = Math.max(0, Number(options.initialState?.overdriveActiveRemaining || 0));
    this.bombAvailable = options.initialState?.bombAvailable !== false && !Boolean(options.initialState?.bombUsed);
    this.bombUsed = Boolean(options.initialState?.bombUsed);
    this.bombFlashTimer = 0;
    // Patch 6: portrait-only special-ability VFX budgets. These counters never
    // affect bomb damage, enemy HP, score, overdrive fire rate or timers.
    this.bombVfxEffectBudget = Number.POSITIVE_INFINITY;
    this.bombVfxDetailedRemaining = Number.POSITIVE_INFINITY;
    this.bombSnapshotTimer = 0;
    this.bossLaser = null;
    this.miniBossScript = { phase: 1, step: 0, timer: 1.15, safeGapSide: -1 };
    this.finalBossScript = { phase: 1, step: 0, timer: 1.25, safeGapSide: -1, laserSide: -1 };
    const start = options.initialState?.waveStart || {};
    this.waveStart = {
      score: Math.max(0, Number(start.score ?? this.score)),
      kills: Math.max(0, Number(start.kills ?? this.stats.kills)),
      shotsFired: Math.max(0, Number(start.shotsFired ?? this.stats.shotsFired)),
      shotsHit: Math.max(0, Number(start.shotsHit ?? this.stats.shotsHit)),
      damageTaken: Math.max(0, Number(start.damageTaken ?? this.stats.damageTaken))
    };

    this.playerBullets = [];
    this.enemyBullets = [];
    this.effects = [];
    this.enemies = [];
    this.spawnFormation();

    this.patternDirector = new PatternDirector({
      difficulty: this.difficulty,
      random: this.random,
      budget: this.waveDef.patternBudget,
      allowedPatterns: this.waveDef.allowedPatterns,
      patternWeights: this.waveDef.patternWeights,
      signaturePattern: this.waveDef.signaturePattern
    });
    const savedPatterns = options.initialState?.patternActivations || {};
    for (const id of Object.keys(this.patternDirector.activations)) {
      this.patternDirector.activations[id] = Math.max(0, Number(savedPatterns[id] || 0));
    }
    this.patternDirector.lastPattern = String(options.initialState?.lastPattern || '');

    // Patch 5 — Safari stable viewport. iOS Safari fires resize events while
    // its browser chrome expands/collapses. Treat height-only toolbar changes as
    // presentation noise so the Canvas backing store is not reallocated mid-run.
    this.stableViewportWidth = 0;
    this.stableViewportHeight = 0;
    this.stableViewportOrientation = '';
    this.viewportResizeTimer = 0;
    this.boundResize = () => this.handleViewportResize('window');
    this.boundViewportResize = () => this.handleViewportResize('visualViewport');
    this.boundKeyDown = (event) => this.handleKeyDown(event);
    this.boundKeyUp = (event) => this.handleKeyUp(event);
    this.boundPointerDown = (event) => this.handlePointerDown(event);
    this.boundPointerMove = (event) => this.handlePointerMove(event);
    this.boundPointerUp = (event) => this.handlePointerUp(event);
  }

  adaptiveVfxScale() {
    if (!this.mobilePortrait) return 1;
    if (this.safariPortrait) return 0;
    if (this.adaptiveVfxLevel >= 2) return 0.54;
    if (this.adaptiveVfxLevel === 1) return 0.76;
    return 1;
  }

  vfxGlow(value) {
    const numeric = Math.max(0, Number(value) || 0);
    // shadowBlur is disproportionately expensive on iOS Safari's Canvas 2D
    // compositor. Keep silhouettes/sprites intact and drop only the blur halo.
    if (this.safariPortrait) return 0;
    return this.mobilePortrait ? numeric * 0.58 * this.adaptiveVfxScale() : numeric;
  }

  vfxComposite(mode = 'source-over') {
    // Additive blending can trigger costly offscreen compositing in Safari.
    return this.safariPortrait && mode === 'lighter' ? 'source-over' : mode;
  }

  cacheCanvasRect(force = false) {
    if (force || !this.canvasRect) this.canvasRect = this.canvas.getBoundingClientRect();
    return this.canvasRect;
  }

  queuePointerSample(event) {
    let sample = event;
    if (typeof event.getCoalescedEvents === 'function') {
      const samples = event.getCoalescedEvents();
      if (samples?.length) sample = samples[samples.length - 1];
    }
    this.pendingPointerClientX = Number(sample.clientX);
    this.pendingPointerId = event.pointerId;
  }

  flushPointerInput() {
    if (!Number.isFinite(this.pendingPointerClientX)) return;
    const clientX = this.pendingPointerClientX;
    this.pendingPointerClientX = null;
    if (this.player.respawnTimer > 0 || this.player.lives <= 0) return;
    const rect = this.cacheCanvasRect();
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    this.player.x = clamp(x, 0.055, 0.945);
  }

  observeRenderPerformance(time) {
    if (!this.mobilePortrait) {
      this.adaptiveVfxLevel = 0;
      this.lastRenderSampleTime = time;
      this.slowRenderMs = 0;
      this.fastRenderMs = 0;
      return;
    }

    // Patch 6: Overdrive keeps the portrait renderer at least on the balanced
    // cosmetic profile for its seven-second lifetime. Simulation stays at full
    // fidelity; only presentation work is reduced.
    const adaptiveFloor = this.safariPortrait ? 2 : (this.overdriveTimer > 0 ? 1 : 0);
    if (this.adaptiveVfxLevel < adaptiveFloor) this.adaptiveVfxLevel = adaptiveFloor;

    if (!this.lastRenderSampleTime) {
      this.lastRenderSampleTime = time;
      return;
    }

    const frameMs = Math.min(80, Math.max(8, time - this.lastRenderSampleTime));
    this.lastRenderSampleTime = time;
    this.renderFrameEmaMs = this.renderFrameEmaMs * 0.90 + frameMs * 0.10;

    // Degrade quickly after sustained missed 60fps frames; recover deliberately
    // so quality does not oscillate every few seconds on mobile Safari.
    if (this.renderFrameEmaMs > 22.5) {
      this.slowRenderMs += frameMs;
      this.fastRenderMs = Math.max(0, this.fastRenderMs - frameMs * 2);
      if (this.slowRenderMs >= 1200 && this.adaptiveVfxLevel < 2) {
        this.adaptiveVfxLevel += 1;
        this.slowRenderMs = 0;
        this.fastRenderMs = 0;
      }
    } else if (this.renderFrameEmaMs < 18.4) {
      this.fastRenderMs += frameMs;
      this.slowRenderMs = Math.max(0, this.slowRenderMs - frameMs * 2);
      if (this.fastRenderMs >= 6000 && this.adaptiveVfxLevel > adaptiveFloor) {
        this.adaptiveVfxLevel = Math.max(adaptiveFloor, this.adaptiveVfxLevel - 1);
        this.fastRenderMs = 0;
        this.slowRenderMs = 0;
      }
    } else {
      this.slowRenderMs = Math.max(0, this.slowRenderMs - frameMs * 0.5);
      this.fastRenderMs = Math.max(0, this.fastRenderMs - frameMs * 0.5);
    }

    // Patch 4: never force Safari into a permanent 30 FPS presentation lock.
    // The low-cost Safari render profile stays active, while frame pacing is
    // handled directly by frame() against real elapsed time.
    if (this.safariPortrait) {
      this.safariStable30 = false;
      this.safariSlowLockMs = 0;
    }
  }

  emitVfx(type, payload = {}) {
    try { this.onVfxEvent({ type, wave: this.currentWave, ...payload }); } catch {}
  }

  emitAudio(type, payload = {}) {
    try { this.onAudioEvent({ type, wave: this.currentWave, ...payload }); } catch {}
  }

  triggerShake(strength = 0.5, duration = 0.18) {
    if (this.reducedMotion) return;
    const normalized = clamp(Number(strength || 0), 0, 1.6);
    if (normalized >= this.visualShake.strength || this.visualShake.timer <= 0) {
      this.visualShake = { strength: normalized, timer: Math.max(0.04, Number(duration || 0.18)), duration: Math.max(0.04, Number(duration || 0.18)) };
    }
  }

  triggerVisualFreeze(duration = 0.055) {
    if (this.reducedMotion) return;
    this.visualFreezeTimer = Math.max(this.visualFreezeTimer, Math.min(0.12, Math.max(0, Number(duration || 0))));
  }

  currentViewportOrientation() {
    return window.matchMedia?.('(orientation: portrait)')?.matches ? 'portrait' : 'landscape';
  }

  currentViewportWidth() {
    return Math.round(Number(window.visualViewport?.width || window.innerWidth || 0));
  }

  lockSafariGameplayViewport(rect = this.canvasRect) {
    if (!this.safariPortrait || !rect) return;
    const width = Math.max(1, Math.round(Number(rect.width || window.innerWidth || 1)));
    const height = Math.max(1, Math.round(Number(rect.height || window.innerHeight || 1)));
    this.stableViewportWidth = width;
    this.stableViewportHeight = height;
    this.stableViewportOrientation = this.currentViewportOrientation();
    const root = document.documentElement;
    root.style.setProperty('--safari-game-width', `${width}px`);
    root.style.setProperty('--safari-game-height', `${height}px`);
    root.classList.add('safari-gameplay-viewport-locked');
  }

  unlockSafariGameplayViewport() {
    const root = document.documentElement;
    root.classList.remove('safari-gameplay-viewport-locked');
    root.style.removeProperty('--safari-game-width');
    root.style.removeProperty('--safari-game-height');
    this.stableViewportWidth = 0;
    this.stableViewportHeight = 0;
    this.stableViewportOrientation = '';
  }

  handleViewportResize(source = 'window') {
    if (!this.running) return;

    const orientation = this.currentViewportOrientation();
    const viewportWidth = this.currentViewportWidth();
    const baselineWidth = Math.max(1, Number(this.stableViewportWidth || this.canvasRect?.width || viewportWidth || 1));
    const widthDelta = Math.abs(viewportWidth - baselineWidth);
    const orientationChanged = Boolean(this.stableViewportOrientation && orientation !== this.stableViewportOrientation);

    // On Safari portrait, browser chrome mostly changes viewport HEIGHT. Ignore
    // those events completely: no getBoundingClientRect(), no CSS mutations and
    // most importantly no canvas.width/canvas.height reset.
    if (this.safariPortrait && !orientationChanged && widthDelta < 40) return;

    // visualViewport can emit several intermediate sizes during rotation. Wait
    // briefly for the real orientation/width to settle, then perform one resize.
    if (this.viewportResizeTimer) window.clearTimeout(this.viewportResizeTimer);
    this.viewportResizeTimer = window.setTimeout(() => {
      this.viewportResizeTimer = 0;
      if (!this.running) return;
      this.resize({ force: true, reason: source });
    }, this.safariMobile ? 180 : 60);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize({ force: true, reason: 'start' });
    this.cacheCanvasRect(true);
    if (this.safariPortrait) this.lockSafariGameplayViewport(this.canvasRect);
    this.lastRenderSampleTime = 0;
    this.renderFrameEmaMs = this.targetFrameMs;
    this.slowRenderMs = 0;
    this.fastRenderMs = 0;
    this.safariStable30 = false;
    this.safariSlowLockMs = 0;
    this.lastDrawTime = 0;
    this.safariFrameBufferMs = 0;
    this.hudDirty = false;
    this.hudFlushClock = 0;
    window.addEventListener('resize', this.boundResize, { passive: true });
    window.visualViewport?.addEventListener('resize', this.boundViewportResize, { passive: true });
    window.addEventListener('keydown', this.boundKeyDown, { passive: false });
    window.addEventListener('keyup', this.boundKeyUp, { passive: false });
    this.canvas.addEventListener('pointerdown', this.boundPointerDown, { passive: false });
    this.canvas.addEventListener('pointermove', this.boundPointerMove, { passive: false });
    this.canvas.addEventListener('pointerup', this.boundPointerUp, { passive: false });
    this.canvas.addEventListener('pointercancel', this.boundPointerUp, { passive: false });
    this.emitHud();
    if (this.waveElapsed < 1.5) this.waveStartFxTimer = 1.25;
    this.emitVfx(this.currentWave === 10 ? 'boss-intro' : this.currentWave === 5 ? 'mini-boss-intro' : 'wave-start', { label: this.waveDef.label, final: this.currentWave === 10 });
    this.lastTime = performance.now();
    this.frameAccumulatorMs = 0;
    this.raf = requestAnimationFrame((time) => this.frame(time));
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.boundResize);
    window.visualViewport?.removeEventListener('resize', this.boundViewportResize);
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    this.canvas.removeEventListener('pointerdown', this.boundPointerDown);
    this.canvas.removeEventListener('pointermove', this.boundPointerMove);
    this.canvas.removeEventListener('pointerup', this.boundPointerUp);
    this.canvas.removeEventListener('pointercancel', this.boundPointerUp);
    this.pendingPointerClientX = null;
    this.pendingPointerId = null;
    this.canvasRect = null;
    if (this.viewportResizeTimer) {
      window.clearTimeout(this.viewportResizeTimer);
      this.viewportResizeTimer = 0;
    }
    this.unlockSafariGameplayViewport();
    document.documentElement.classList.remove('safari-portrait-render');
    if (this.bombSnapshotTimer) {
      window.clearTimeout(this.bombSnapshotTimer);
      this.bombSnapshotTimer = 0;
    }
  }

  resize({ force = false, reason = 'manual' } = {}) {
    // Patch 5: on Safari portrait the only legitimate mid-run resize is a real
    // orientation/width change. Height-only toolbar motion is filtered before
    // reaching this method by handleViewportResize().
    const previousRect = this.canvasRect;
    const rect = this.cacheCanvasRect(true);
    const wasMobilePortrait = this.mobilePortrait;
    const wasSafariPortrait = this.safariPortrait;
    const previousOrientation = this.stableViewportOrientation || this.currentViewportOrientation();
    this.mobilePortrait = isPortraitMobile();
    this.safariMobile = isSafariMobile();
    this.safariPortrait = this.safariMobile && this.mobilePortrait;
    document.documentElement.classList.toggle('safari-portrait-render', this.safariPortrait);

    const currentOrientation = this.currentViewportOrientation();
    const actualWidthChange = !previousRect || Math.abs(Number(rect.width || 0) - Number(previousRect.width || 0)) >= 2;
    const orientationChanged = currentOrientation !== previousOrientation;

    // If a direct caller reaches resize during Safari toolbar motion, keep the
    // existing backing store as a second line of defence.
    if (!force && wasSafariPortrait && this.safariPortrait && !orientationChanged && !actualWidthChange) {
      this.canvasRect = previousRect || rect;
      return;
    }

    // Safari portrait renders materially fewer backing-store pixels. CSS size
    // is unchanged, so layout/input coordinates and gameplay remain identical.
    const dprCap = this.safariPortrait ? 1.0 : (this.mobilePortrait ? 1.5 : 2);
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.dpr = dpr;

    if (this.safariPortrait) {
      this.lockSafariGameplayViewport(rect);
    } else if (wasSafariPortrait) {
      this.unlockSafariGameplayViewport();
      this.stableViewportOrientation = currentOrientation;
      this.stableViewportWidth = Math.round(rect.width || window.innerWidth || 0);
      this.stableViewportHeight = Math.round(rect.height || window.innerHeight || 0);
    } else {
      this.stableViewportOrientation = currentOrientation;
      this.stableViewportWidth = Math.round(rect.width || window.innerWidth || 0);
      this.stableViewportHeight = Math.round(rect.height || window.innerHeight || 0);
    }

    if (!wasMobilePortrait && this.mobilePortrait && this.ambientParticles?.length > 28) {
      this.ambientParticles = this.ambientParticles.slice(0, 28);
    }
    if (this.safariPortrait && this.ambientParticles?.length > 16) {
      this.ambientParticles = this.ambientParticles.slice(0, 16);
    }
    if (wasMobilePortrait !== this.mobilePortrait || wasSafariPortrait !== this.safariPortrait) {
      this.adaptiveVfxLevel = this.safariPortrait ? 2 : 0;
      this.renderFrameEmaMs = this.targetFrameMs;
      this.lastRenderSampleTime = 0;
      this.slowRenderMs = 0;
      this.fastRenderMs = 0;
      this.safariStable30 = false;
      this.safariSlowLockMs = 0;
      this.lastDrawTime = 0;
      this.safariFrameBufferMs = 0;
      this.hudDirty = false;
      this.hudFlushClock = 0;
    }
  }

  handleKeyDown(event) {
    const key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'a', 'd', ' ', 'shift'].includes(key)) event.preventDefault();
    if (key === 'shift' && !event.repeat) this.useBomb();
    this.keys.add(key);
  }

  handleKeyUp(event) {
    const key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'a', 'd', ' ', 'shift'].includes(key)) event.preventDefault();
    this.keys.delete(key);
  }

  handlePointerDown(event) {
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.cacheCanvasRect(true);
    this.canvas.setPointerCapture?.(event.pointerId);
    this.queuePointerSample(event);
  }

  handlePointerMove(event) {
    if (this.pointerId !== event.pointerId) return;
    event.preventDefault();
    this.queuePointerSample(event);
  }

  handlePointerUp(event) {
    if (this.pointerId !== event.pointerId) return;
    event.preventDefault();
    this.queuePointerSample(event);
    this.pointerId = null;
    this.canvas.releasePointerCapture?.(event.pointerId);
  }

  spawnFormation() {
    const stamp = `${Date.now()}-${Math.floor(this.random() * 1e6)}`;
    const formation = makeFormation(this.waveDef, { portrait: this.canvas.height >= this.canvas.width });
    this.enemies = formation.map((formationSlot, index) => {
      const { type, x, y, group = '', lane = '', order = index } = formationSlot;
      const spec = ENEMY[type] || ENEMY.fighter;
      const combatHp = combatHpForDifficulty(type, this.difficulty);
      return {
        id: `${type}-${stamp}-${index}`,
        type,
        combatRole: spec.role || 'line',
        formationGroup: group,
        formationLane: lane,
        formationOrder: order,
        baseX: x,
        baseY: y,
        x,
        y,
        alive: true,
        hp: combatHp,
        maxHp: combatHp,
        bossPhase: ['miniBoss', 'finalBoss'].includes(type) ? 1 : null,
        phase: index * 0.55,
        mode: 'formation',
        attackTime: 0,
        attackDuration: 0,
        attack: null,
        rotation: Math.PI,
        slotIndex: index,
        fireCooldown: ['miniBoss', 'finalBoss'].includes(type) ? 0.9 : 0.6 + this.random() * 1.4,
        spawnAge: -Math.min(0.82, Math.max(index * 0.018, Number(order || 0) * 0.105)),
        spawnDuration: ['miniBoss', 'finalBoss'].includes(type) ? 0.9 : 0.62,
        idleSeed: this.random() * Math.PI * 2,
        hitFlashTimer: 0,
        hpReadTimer: 0,
        telegraphTimer: 0,
        telegraphDuration: 0,
        pendingShot: null,
        pendingBurst: null,
        attackShots: 0,
        trailClock: 0,
        trailPoints: [],
        bossTargetX: ['miniBoss', 'finalBoss'].includes(type) ? 0.5 : null,
        pendingBossAttack: null
      };
    });
    this.formationRespawnClock = 0;
    for (const enemy of this.enemies) {
      this.effects.push({ x: enemy.x, y: enemy.y, age: 0, duration: ['miniBoss', 'finalBoss'].includes(enemy.type) ? 0.65 : 0.38, kind: 'spawn' });
    }
  }

  frame(time) {
    if (!this.running) return;
    const rawMs = Math.min(100, Math.max(0, time - this.lastTime));
    this.lastTime = time;

    // Patch 4 — Safari portrait frame pacing.
    // Do not use the fixed 16.667 ms accumulator here: WebKit rAF timestamps
    // commonly oscillate slightly around the boundary, which caused periodic
    // update/render skips. Instead collect real elapsed time and present at a
    // maximum of ~60 Hz. On 120 Hz displays this naturally consumes two rAF
    // callbacks per game frame; on 60 Hz displays it consumes every callback.
    if (this.safariPortrait) {
      this.safariFrameBufferMs = Math.min(50, Number(this.safariFrameBufferMs || 0) + rawMs);
      const sinceDraw = this.lastDrawTime ? time - this.lastDrawTime : 1000;
      // 14 ms is deliberately below 16.667 ms so normal 60 Hz timestamp jitter
      // never drops a visible frame, while 120 Hz callbacks are still capped.
      if (sinceDraw < 14) {
        this.raf = requestAnimationFrame((nextTime) => this.frame(nextTime));
        return;
      }

      this.flushPointerInput();
      const frameMs = Math.min(34, Math.max(1, this.safariFrameBufferMs));
      this.safariFrameBufferMs = 0;
      // Patch 7 — do one real-time simulation pass per presented Safari frame.
      // The previous >22 ms split doubled all array scans/collision/pattern work
      // exactly when WebKit was already late. A 22–34 ms dt is already supported
      // by the desktop path, so keeping one pass preserves real elapsed gameplay
      // time without creating a self-reinforcing low-FPS workload.
      const dt = frameMs / 1000;
      this.elapsed += dt;
      this.update(dt);
      this.draw();
      this.lastDrawTime = time;
      this.observeRenderPerformance(time);
      this.raf = requestAnimationFrame((nextTime) => this.frame(nextTime));
      return;
    }

    if (this.mobilePortrait) {
      this.frameAccumulatorMs = Math.min(this.targetFrameMs * 2, this.frameAccumulatorMs + rawMs);
      if (this.frameAccumulatorMs + 0.01 < this.targetFrameMs) {
        this.raf = requestAnimationFrame((nextTime) => this.frame(nextTime));
        return;
      }
      const steps = Math.min(2, Math.floor(this.frameAccumulatorMs / this.targetFrameMs));
      this.flushPointerInput();
      for (let step = 0; step < steps; step += 1) {
        const dt = this.targetFrameMs / 1000;
        this.elapsed += dt;
        this.update(dt);
      }
      this.frameAccumulatorMs -= steps * this.targetFrameMs;
      this.draw();
      this.lastDrawTime = time;
      this.observeRenderPerformance(time);
    } else {
      this.flushPointerInput();
      const dt = Math.min(0.034, rawMs / 1000);
      this.elapsed += dt;
      this.update(dt);
      this.draw();
      this.observeRenderPerformance(time);
    }

    this.raf = requestAnimationFrame((nextTime) => this.frame(nextTime));
  }

  update(dt) {
    if (this.player.lives <= 0) return;

    this.visualShake.timer = Math.max(0, this.visualShake.timer - dt);
    if (this.visualShake.timer <= 0) this.visualShake.strength = 0;
    this.visualFreezeTimer = Math.max(0, this.visualFreezeTimer - dt);
    this.overdriveBurstTimer = Math.max(0, this.overdriveBurstTimer - dt);
    this.bossPhaseBurstTimer = Math.max(0, this.bossPhaseBurstTimer - dt);
    this.waveStartFxTimer = Math.max(0, this.waveStartFxTimer - dt);
    this.bossLaserFireFlashTimer = Math.max(0, this.bossLaserFireFlashTimer - dt);
    this.waveElapsed += dt;
    if (!this.enraged && this.waveElapsed >= Math.max(30, Number(this.waveDef.timeCap || 45) - 7)) {
      this.enraged = true;
      this.patternBanner = { label: 'ENRAGE', timer: 1.4 };
    }
    this.updateAbilities(dt);
    this.updateCombo(dt);
    this.updatePlayer(dt);
    this.updatePlayerVfx(dt);
    this.updateEnemies(dt);
    this.updateLastStandState();
    this.recoveryTimer = Math.max(0, Number(this.recoveryTimer || 0) - dt);
    this.updateEnemyShotTelegraphs(dt);
    this.patternDirector.update(dt, this);
    this.updatePlayerBullets(dt);
    this.updateEnemyBullets(dt);
    this.updateBossSpecials(dt);
    this.updateCollisions();
    this.updateEffects(dt);
    if (this.safariPortrait && this.hudDirty) {
      this.hudFlushClock += dt;
      // Four HUD commits per second are visually continuous for score/energy,
      // while avoiding repeated selector/style work in WebKit's hot path.
      if (this.hudFlushClock >= 0.25) this.flushHud();
    }
    this.updateEnemyFire(dt);
    this.updateFormationLifecycle(dt);
    this.patternBanner.timer = Math.max(0, this.patternBanner.timer - dt);

    this.snapshotClock += dt;
    if (this.snapshotClock >= CORE_STATE_SYNC_INTERVAL_SECONDS) {
      this.snapshotClock = 0;
      this.onSnapshot(this.snapshot(), { reason: 'periodic' });
    }
  }

  updateAbilities(dt) {
    if (this.overdriveTimer > 0) {
      const before = this.overdriveTimer;
      this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
      if (before > 0 && this.overdriveTimer <= 0) this.patternBanner = { label: 'OVERDRIVE END', timer: 0.9 };
    }
    this.bombFlashTimer = Math.max(0, this.bombFlashTimer - dt);
  }

  addOverdriveEnergy(amount = 4) {
    if (this.overdriveTimer > 0) return;
    this.overdriveEnergy = clamp(this.overdriveEnergy + Number(amount || 0), 0, 100);
    if (this.overdriveEnergy >= 100) {
      this.overdriveEnergy = 0;
      this.overdriveTimer = 7;
      if (this.mobilePortrait) this.adaptiveVfxLevel = Math.max(1, this.adaptiveVfxLevel);
      this.overdriveBurstTimer = 0.95;
      this.patternBanner = { label: 'OVERDRIVE', timer: 1.35 };
      this.triggerShake(0.42, 0.24);
      this.emitVfx('overdrive-start', { duration: 7 });
    }
  }

  useBomb() {
    if (!this.bombAvailable || this.player.lives <= 0 || this.player.respawnTimer > 0 || this.waveClearPending) return false;
    this.bombAvailable = false;
    this.bombUsed = true;
    this.bombFlashTimer = 0.82;
    this.triggerShake(this.mobilePortrait ? 0.82 : 1.10, this.mobilePortrait ? 0.30 : 0.42);
    this.triggerVisualFreeze(this.mobilePortrait ? 0.045 : 0.075);
    this.emitVfx('bomb', { x: this.player.x, y: this.player.y });
    this.enemyBullets = [];
    this.bossLaser = null;

    // Portrait Safari can stall when every destroyed enemy creates a complete
    // layered death stack in the same frame. Keep the exact bomb gameplay but
    // cap presentation work to a predictable budget.
    this.bombVfxEffectBudget = this.mobilePortrait ? 32 : Number.POSITIVE_INFINITY;
    this.bombVfxDetailedRemaining = this.mobilePortrait ? 3 : Number.POSITIVE_INFINITY;
    this.effects.push({ x: this.player.x, y: this.player.y - 0.04, age: 0, duration: 0.62, kind: 'bomb' });
    let portraitHitFlashes = 0;
    for (const enemy of [...this.enemies]) {
      if (!enemy.alive) continue;
      enemy.hp = Math.max(0, Number(enemy.hp || 1) - 1);
      if (enemy.hp <= 0) {
        this.killEnemyByBomb(enemy);
      } else if (!this.mobilePortrait || portraitHitFlashes < 4) {
        this.effects.push({ x: enemy.x, y: enemy.y, age: 0, duration: 0.20, kind: 'hit' });
        portraitHitFlashes += 1;
      }
    }
    this.patternBanner = { label: 'BOMB', timer: 1.0 };
    this.emitHud();

    // Patch 6: let the first bomb frames render before network serialization and
    // fetch callbacks begin on mobile. State is identical; only the flush timing
    // moves by ~120 ms.
    const bombSnapshot = this.snapshot();
    if (this.mobilePortrait) {
      if (this.bombSnapshotTimer) window.clearTimeout(this.bombSnapshotTimer);
      this.bombSnapshotTimer = window.setTimeout(() => {
        this.bombSnapshotTimer = 0;
        if (this.running && !this.waveClearPending) this.onSnapshot(bombSnapshot, { reason: 'bomb' });
      }, 120);
    } else {
      this.onSnapshot(bombSnapshot, { reason: 'bomb' });
    }
    return true;
  }

  killEnemyByBomb(enemy) {
    if (!enemy?.alive) return;
    enemy.alive = false;
    enemy.mode = 'dead';
    this.stats.kills += 1;
    this.stats.killsByType[enemy.type] = (this.stats.killsByType[enemy.type] || 0) + 1;
    this.stats.bombKillsByType[enemy.type] = (this.stats.bombKillsByType[enemy.type] || 0) + 1;
    this.spawnEnemyDeathVfx(enemy, { bomb: true });
    if (enemy.type === 'finalBoss') {
      this.cleanupFinalBossAdds(enemy.id);
      this.patternBanner = { label: 'BOSS DESTROYED +5,000', timer: 1.8 };
      this.triggerShake(1.35, 0.62);
      this.triggerVisualFreeze(0.11);
      this.emitVfx('boss-destroyed', { x: enemy.x, y: enemy.y, bomb: true });
    }
  }

  miniBoss() {
    return this.enemies.find((enemy) => enemy.alive && enemy.type === 'miniBoss') || null;
  }

  miniBossChargeAsset(kind) {
    if (kind === 'targetHeavy') return 'miniBossHeavyCharge';
    if (kind === 'safeFan') return 'miniBossPhaseAura';
    return 'miniBossTriOrbCharge';
  }

  spawnMiniBossChargeFx(boss, kind, payload = {}, delay = 0.45) {
    if (!boss?.alive) return;
    const duration = Math.max(0.20, delay + 0.12);
    const chargeSprite = this.miniBossChargeAsset(kind);
    this.effects.push({
      x: boss.x, y: boss.y + 0.058, age: 0, duration, kind: 'spriteEffect',
      spriteKey: chargeSprite, sizeMul: kind === 'safeFan' ? 1.22 : kind === 'targetHeavy' ? 1.10 : 0.98,
      alphaMul: kind === 'targetHeavy' ? 0.92 : 0.84, spin: kind === 'safeFan' ? 0.22 : 0.12,
      pulse: true, grow: kind === 'safeFan' ? 0.28 : 0.16, shadowColor: '#ff965d'
    });
    if (kind === 'targetHeavy') {
      const targetX = Number(payload.targetX ?? this.player.x);
      const targetY = Number(payload.targetY ?? this.player.y);
      this.effects.push({
        x: targetX, y: targetY, age: 0, duration: duration + 0.10, kind: 'spriteEffect',
        spriteKey: 'miniBossTargetReticle', sizeMul: 0.92, alphaMul: 0.96, spin: 0.16,
        pulse: true, grow: 0.12, shadowColor: '#ff8044'
      });
    }
  }

  miniBossPhase(boss = this.miniBoss()) {
    if (!boss) return 0;
    const ratio = Number(boss.hp || 0) / Math.max(1, Number(boss.maxHp || 1));
    return ratio > 0.50 ? 1 : 2;
  }

  setMiniBossTarget(boss, x) {
    if (!boss?.alive) return;
    boss.bossTargetX = clamp(Number(x ?? 0.5), 0.20, 0.80);
  }

  scheduleMiniBossAttack(boss, kind, delay = 0.45, payload = {}) {
    if (!boss?.alive || boss.pendingBossAttack) return false;
    const duration = Math.max(0.22, Number(delay || 0.45));
    boss.pendingBossAttack = { kind, timer: duration, duration, payload: { ...payload } };
    const targetX = Number(payload.targetX ?? this.player.x);
    const targetY = Number(payload.targetY ?? this.player.y);
    this.effects.push({
      x: kind === 'targetHeavy' ? targetX : boss.x,
      y: kind === 'targetHeavy' ? targetY : boss.y + 0.055,
      age: 0,
      duration: duration + 0.08,
      kind: kind === 'targetHeavy' ? 'bossTarget' : 'shotCharge',
      enemyType: 'miniBoss', targetX, targetY
    });
    this.spawnMiniBossChargeFx(boss, kind, { ...payload, targetX, targetY }, duration);
    return true;
  }

  executeMiniBossAttack(boss, attack) {
    if (!boss?.alive || !attack) return;
    const kind = String(attack.kind || '');
    const payload = attack.payload || {};
    if (kind === 'tripleAim') this.fireMiniBossAimedVolley(boss, 3, 0.105, 1.0, 'miniBossTripleBullet');
    else if (kind === 'arcSweep') this.fireMiniBossArc(boss, 5, 0.46, 0.90, 0, 'miniBossArcBullet');
    else if (kind === 'alternatingSpread') this.fireMiniBossArc(boss, this.difficulty === 'hard' ? 9 : 7, this.difficulty === 'hard' ? 0.62 : 0.56, this.difficulty === 'hard' ? 1.12 : this.difficulty === 'medium' ? 1.04 : 0.98, Number(payload.bias || 0), 'miniBossAlternatingBullet');
    else if (kind === 'targetHeavy') this.fireMiniBossTargetHeavy(boss, Number(payload.targetX ?? this.player.x));
    else if (kind === 'safeFan') this.fireMiniBossSafeFan(boss, Number(payload.safeGapSide || -1));
  }

  fireMiniBossAimedVolley(boss, count = 3, angleStep = 0.10, speedScale = 1, sprite = 'miniBossTripleBullet') {
    if (!boss?.alive) return false;
    const cap = 28;
    if (this.enemyBullets.length >= cap - count) return false;
    const dx = this.player.x - boss.x;
    const dy = Math.max(0.20, this.player.y - boss.y);
    const base = Math.atan2(dx, dy);
    const speed = this.tuning.enemyBulletSpeed * speedScale;
    this.effects.push({ x: boss.x, y: boss.y + 0.07, age: 0, duration: 0.16, kind: 'enemyMuzzle', enemyType: 'miniBoss', charged: false });
    for (let i = 0; i < count; i += 1) {
      const offset = (i - (count - 1) / 2) * angleStep;
      const angle = base + offset;
      this.enemyBullets.push({ x: boss.x, y: boss.y + 0.075, vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed, sprite, charged: false, trailColor: '#ff9a66', sizeMul: 1.04 });
    }
    return true;
  }

  fireMiniBossArc(boss, count = 5, arc = 0.46, speedScale = 0.9, bias = 0, sprite = 'miniBossArcBullet') {
    if (!boss?.alive) return false;
    if (this.enemyBullets.length >= 28 - count) return false;
    const speed = this.tuning.enemyBulletSpeed * speedScale;
    this.effects.push({ x: boss.x, y: boss.y + 0.07, age: 0, duration: 0.16, kind: 'enemyMuzzle', enemyType: 'miniBoss', charged: false });
    const color = sprite === 'miniBossAlternatingBullet' ? '#ffb264' : '#ff8f5b';
    for (let i = 0; i < count; i += 1) {
      const t = count <= 1 ? 0.5 : i / (count - 1);
      const angle = lerp(-arc, arc, t) + bias;
      this.enemyBullets.push({ x: boss.x, y: boss.y + 0.075, vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed, sprite, charged: false, trailColor: color, sizeMul: sprite === 'miniBossAlternatingBullet' ? 1.02 : 1.10 });
    }
    return true;
  }

  fireMiniBossTargetHeavy(boss, targetX = this.player.x) {
    if (!boss?.alive || this.enemyBullets.length >= 27) return false;
    const dx = clamp(targetX, 0.06, 0.94) - boss.x;
    const dy = Math.max(0.20, this.player.y - boss.y);
    const mag = Math.hypot(dx, dy) || 1;
    const speed = this.tuning.enemyBulletSpeed * (this.difficulty === 'hard' ? 1.16 : this.difficulty === 'medium' ? 1.08 : 1.02);
    this.effects.push({ x: boss.x, y: boss.y + 0.07, age: 0, duration: 0.20, kind: 'enemyMuzzle', enemyType: 'miniBoss', charged: true });
    this.effects.push({ x: boss.x, y: boss.y + 0.075, age: 0, duration: 0.34, kind: 'spriteEffect', spriteKey: 'miniBossHeavyCharge', sizeMul: 1.04, alphaMul: 0.62, pulse: true, grow: 0.12, shadowColor: '#ffab61' });
    this.enemyBullets.push({ x: boss.x, y: boss.y + 0.075, vx: (dx / mag) * speed, vy: (dy / mag) * speed, sprite: 'miniBossHeavyProjectile', charged: true, sizeMul: 1.20, trailColor: '#ffc57a' });
    return true;
  }

  fireMiniBossSafeFan(boss, safeGapSide = -1) {
    if (!boss?.alive) return false;
    const count = this.difficulty === 'hard' ? 11 : 9;
    const arc = this.difficulty === 'hard' ? 0.72 : this.difficulty === 'medium' ? 0.66 : 0.62;
    const skip = this.difficulty === 'easy' ? 2 : 1;
    const gapCenter = safeGapSide < 0 ? Math.floor(count * 0.34) : Math.ceil(count * 0.66);
    const bulletsNeeded = count - skip;
    if (this.enemyBullets.length >= 28 - bulletsNeeded) return false;
    const speed = this.tuning.enemyBulletSpeed * (this.difficulty === 'hard' ? 1.12 : this.difficulty === 'medium' ? 1.06 : 1.00);
    this.effects.push({ x: boss.x, y: boss.y + 0.07, age: 0, duration: 0.18, kind: 'enemyMuzzle', enemyType: 'miniBoss', charged: true });
    for (let i = 0; i < count; i += 1) {
      if (Math.abs(i - gapCenter) < skip) continue;
      const t = i / Math.max(1, count - 1);
      const angle = lerp(-arc, arc, t);
      this.enemyBullets.push({ x: boss.x, y: boss.y + 0.075, vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed, sprite: 'miniBossSpread', charged: i % 2 === 0, trailColor: '#ffb76d', sizeMul: 1.10 });
    }
    return true;
  }

  runMiniBossScriptStep(boss, phase) {
    const script = this.miniBossScript;
    const cadence = this.difficulty === 'hard' ? 0.66 : this.difficulty === 'medium' ? 0.80 : 0.94;
    const step = script.step;
    let delay = 0.8;
    if (phase === 1) {
      switch (step % 6) {
        case 0: this.setMiniBossTarget(boss, 0.50); delay = 0.62; break;
        case 1: this.scheduleMiniBossAttack(boss, 'tripleAim', 0.50); delay = 1.02; break;
        case 2: this.setMiniBossTarget(boss, 0.25); delay = 0.72; break;
        case 3: this.scheduleMiniBossAttack(boss, 'arcSweep', 0.42); delay = 1.02; break;
        case 4: this.setMiniBossTarget(boss, 0.75); delay = 0.72; break;
        case 5: this.scheduleMiniBossAttack(boss, 'tripleAim', 0.50); delay = 1.12; break;
      }
    } else {
      switch (step % 6) {
        case 0: this.setMiniBossTarget(boss, 0.26); delay = 0.54; break;
        case 1: this.scheduleMiniBossAttack(boss, 'alternatingSpread', 0.36, { bias: 0.08 }); delay = 0.88; break;
        case 2: this.setMiniBossTarget(boss, 0.74); delay = 0.54; break;
        case 3: {
          const targetX = clamp(this.player.x, 0.08, 0.92);
          this.scheduleMiniBossAttack(boss, 'targetHeavy', 0.58, { targetX, targetY: this.player.y });
          delay = 1.02;
          break;
        }
        case 4: this.setMiniBossTarget(boss, 0.50); delay = 0.54; break;
        case 5: {
          script.safeGapSide *= -1;
          this.scheduleMiniBossAttack(boss, 'safeFan', 0.54, { safeGapSide: script.safeGapSide });
          delay = 1.16;
          break;
        }
      }
    }
    script.step += 1;
    script.timer = delay * cadence;
  }

  updateMiniBossFight(dt) {
    const boss = this.miniBoss();
    if (!boss) return;
    const phase = this.miniBossPhase(boss);
    if (boss.bossPhase !== phase) {
      boss.bossPhase = phase;
      this.miniBossScript = { phase, step: 0, timer: 0.82, safeGapSide: this.miniBossScript?.safeGapSide || -1 };
      boss.pendingBossAttack = null;
      this.enemyBullets = this.enemyBullets.filter((bullet) => bullet.y < 0.34);
      this.patternBanner = { label: 'MINI BOSS PHASE 2', timer: 1.25 };
      this.bossPhaseBurstTimer = 0.82;
      this.triggerShake(0.72, 0.28);
      this.triggerVisualFreeze(0.05);
      this.emitVfx('mini-boss-phase', { phase, hp: boss.hp, maxHp: boss.maxHp });
      if (phase === 2) {
        this.effects.push({ x: boss.x, y: boss.y, age: 0, duration: 0.60, kind: 'spriteEffect', spriteKey: 'miniBossPhaseBurst', sizeMul: 1.55, alphaMul: 0.90, pulse: true, spin: 0.18, grow: 0.24, shadowColor: '#ff935b' });
      }
    }

    if (boss.pendingBossAttack) {
      boss.pendingBossAttack.timer = Math.max(0, Number(boss.pendingBossAttack.timer || 0) - dt);
      if (boss.pendingBossAttack.timer <= 0) {
        const attack = boss.pendingBossAttack;
        boss.pendingBossAttack = null;
        this.executeMiniBossAttack(boss, attack);
      }
    }

    if (Number(boss.spawnAge || 0) < Number(boss.spawnDuration || 0) + 0.45) return;
    this.miniBossScript.timer -= dt * (this.enraged ? 1.10 : 1);
    if (this.miniBossScript.timer <= 0 && !boss.pendingBossAttack) this.runMiniBossScriptStep(boss, phase);
  }

  finalBoss() {
    return this.enemies.find((enemy) => enemy.alive && enemy.type === 'finalBoss') || null;
  }

  finalBossPhase(boss = this.finalBoss()) {
    if (!boss) return 0;
    const ratio = Number(boss.hp || 0) / Math.max(1, Number(boss.maxHp || 1));
    if (ratio > 0.67) return 1;
    if (ratio > 0.33) return 2;
    return 3;
  }

  setFinalBossTarget(boss, x) {
    if (!boss?.alive) return;
    boss.bossTargetX = clamp(Number(x ?? 0.5), 0.16, 0.84);
  }

  finalBossBulletCap() {
    const portrait = this.canvas.height >= this.canvas.width;
    const base = this.difficulty === 'hard' ? 32 : this.difficulty === 'medium' ? 28 : 24;
    return Math.max(14, Math.round(base * (portrait ? 0.84 : 1)));
  }

  finalBossChargeSprite(kind) {
    if (kind === 'laser') return 'finalBossLaserTelegraph';
    if (kind === 'safeGap' || kind === 'fiveFan' || kind === 'sevenSpread' || kind === 'alternatingArc') return 'finalBossSpread';
    return 'finalBossBullet';
  }

  spawnFinalBossChargeFx(boss, kind, payload = {}, delay = 0.42) {
    if (!boss?.alive) return;
    const duration = Math.max(0.16, Number(delay || 0.42) + 0.10);
    const spriteKey = this.finalBossChargeSprite(kind);
    const isLaser = kind === 'laser';
    this.effects.push({
      x: boss.x,
      y: boss.y + 0.072,
      age: 0,
      duration,
      kind: 'spriteEffect',
      spriteKey,
      sizeMul: isLaser ? 1.24 : kind === 'safeGap' ? 1.08 : 0.96,
      alphaMul: isLaser ? 0.52 : 0.84,
      spin: spriteKey === 'finalBossSpread' ? 0.22 : 0.14,
      pulse: true,
      grow: isLaser ? 0.22 : 0.12,
      shadowColor: isLaser ? '#ff7f95' : '#ff9a66'
    });
  }

  scheduleFinalBossAttack(boss, kind, delay = 0.42, payload = {}) {
    if (!boss?.alive || boss.pendingBossAttack) return false;
    const duration = Math.max(0.12, Number(delay || 0.42));
    boss.pendingBossAttack = { kind, timer: duration, duration, payload: { ...payload } };
    const targetX = Number(payload.targetX ?? this.player.x);
    const targetY = Number(payload.targetY ?? this.player.y);
    const isLaser = kind === 'laser';
    this.effects.push({
      x: isLaser ? targetX : boss.x,
      y: isLaser ? 0.48 : boss.y + 0.07,
      age: 0,
      duration: duration + 0.08,
      kind: isLaser ? 'bossTarget' : 'shotCharge',
      enemyType: 'finalBoss', targetX, targetY
    });
    this.spawnFinalBossChargeFx(boss, kind, { ...payload, targetX, targetY }, duration);
    return true;
  }

  executeFinalBossAttack(boss, attack) {
    if (!boss?.alive || !attack) return;
    const kind = String(attack.kind || '');
    const payload = attack.payload || {};
    if (kind === 'doubleAim') this.fireFinalBossAimedVolley(boss, this.difficulty === 'hard' ? 4 : 3, 0.072, this.difficulty === 'hard' ? 1.08 : this.difficulty === 'medium' ? 1.03 : 0.99, 'finalBossBullet', { trailColor: '#ff8aa0', sizeMul: 1.10 });
    else if (kind === 'aimedBurst') this.fireFinalBossAimedVolley(boss, this.difficulty === 'hard' ? 4 : 3, 0.082, this.difficulty === 'hard' ? 1.16 : this.difficulty === 'medium' ? 1.08 : 1.02, 'finalBossBullet', { trailColor: '#ff7f95', sizeMul: 1.12 });
    else if (kind === 'straightLanes') this.fireFinalBossStraightLanes(boss);
    else if (kind === 'fiveFan') this.fireFinalBossArc(boss, 5, 0.46, 0.92, Number(payload.bias || 0), 'finalBossSpread', { trailColor: '#ff9c79', sizeMul: 1.12 });
    else if (kind === 'sevenSpread') this.fireFinalBossArc(boss, this.difficulty === 'hard' ? 9 : 7, this.difficulty === 'hard' ? 0.68 : this.difficulty === 'medium' ? 0.60 : 0.56, this.difficulty === 'hard' ? 1.12 : this.difficulty === 'medium' ? 1.04 : 0.98, Number(payload.bias || 0), 'finalBossSpread', { trailColor: '#ff8b83', sizeMul: 1.14 });
    else if (kind === 'alternatingArc') this.fireFinalBossArc(boss, this.difficulty === 'hard' ? 9 : this.difficulty === 'medium' ? 8 : 7, this.difficulty === 'hard' ? 0.66 : this.difficulty === 'medium' ? 0.61 : 0.58, this.difficulty === 'hard' ? 1.14 : this.difficulty === 'medium' ? 1.06 : 1.00, Number(payload.bias || 0), 'finalBossSpread', { trailColor: '#ff6fa4', sizeMul: 1.16 });
    else if (kind === 'safeGap') this.fireFinalBossSafeGap(boss, Number(payload.safeGapSide || -1));
    else if (kind === 'laser') this.startBossLaser(Number(payload.targetX ?? this.player.x));
  }

  fireFinalBossAimedVolley(boss, count = 2, angleStep = 0.075, speedScale = 1, sprite = 'finalBossBullet', visual = {}) {
    if (!boss?.alive) return false;
    const cap = this.finalBossBulletCap();
    if (this.enemyBullets.length > cap - count) return false;
    const dx = this.player.x - boss.x;
    const dy = Math.max(0.22, this.player.y - boss.y);
    const base = Math.atan2(dx, dy);
    const speed = this.tuning.enemyBulletSpeed * speedScale;
    this.effects.push({ x: boss.x, y: boss.y + 0.085, age: 0, duration: 0.17, kind: 'enemyMuzzle', enemyType: 'finalBoss', charged: false });
    for (let i = 0; i < count; i += 1) {
      const offset = (i - (count - 1) / 2) * angleStep;
      const angle = base + offset;
      this.enemyBullets.push({
        x: boss.x, y: boss.y + 0.085,
        vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed,
        sprite,
        charged: false,
        trailColor: visual.trailColor || '#ff8aa0',
        sizeMul: Number(visual.sizeMul || 1.1)
      });
    }
    return true;
  }

  fireFinalBossStraightLanes(boss) {
    if (!boss?.alive) return false;
    const offsets = this.difficulty === 'hard' ? [-0.096, -0.064, -0.032, 0, 0.032, 0.064, 0.096] : [-0.085, -0.042, 0, 0.042, 0.085];
    const cap = this.finalBossBulletCap();
    if (this.enemyBullets.length > cap - offsets.length) return false;
    const speed = this.tuning.enemyBulletSpeed * (this.difficulty === 'hard' ? 1.08 : this.difficulty === 'medium' ? 1.00 : 0.94);
    this.effects.push({ x: boss.x, y: boss.y + 0.085, age: 0, duration: 0.18, kind: 'enemyMuzzle', enemyType: 'finalBoss', charged: false });
    for (const offset of offsets) {
      this.enemyBullets.push({
        x: clamp(boss.x + offset, 0.05, 0.95),
        y: boss.y + 0.085,
        vx: 0,
        vy: speed,
        sprite: 'finalBossBullet',
        charged: false,
        trailColor: '#ffc36e',
        sizeMul: 1.15
      });
    }
    return true;
  }

  fireFinalBossArc(boss, count = 7, arc = 0.54, speedScale = 0.95, bias = 0, sprite = 'finalBossSpread', visual = {}) {
    if (!boss?.alive) return false;
    const cap = this.finalBossBulletCap();
    if (this.enemyBullets.length > cap - count) return false;
    const speed = this.tuning.enemyBulletSpeed * speedScale;
    this.effects.push({ x: boss.x, y: boss.y + 0.085, age: 0, duration: 0.18, kind: 'enemyMuzzle', enemyType: 'finalBoss', charged: false });
    for (let i = 0; i < count; i += 1) {
      const t = count <= 1 ? 0.5 : i / (count - 1);
      const angle = lerp(-arc, arc, t) + bias;
      this.enemyBullets.push({
        x: boss.x, y: boss.y + 0.085,
        vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed,
        sprite,
        charged: false,
        trailColor: visual.trailColor || '#ff8b83',
        sizeMul: Number(visual.sizeMul || 1.14)
      });
    }
    return true;
  }

  fireFinalBossSafeGap(boss, safeGapSide = -1) {
    if (!boss?.alive) return false;
    const portrait = this.canvas.height >= this.canvas.width;
    const count = this.difficulty === 'hard' ? 11 : 9;
    const arc = this.difficulty === 'hard' ? 0.74 : this.difficulty === 'medium' ? 0.68 : 0.64;
    const baseSkip = this.difficulty === 'easy' ? 2 : 1;
    const skipRadius = baseSkip + (portrait ? 1 : 0);
    const gapCenter = safeGapSide < 0 ? Math.floor(count * 0.30) : Math.ceil(count * 0.70);
    const indices = [];
    for (let i = 0; i < count; i += 1) if (Math.abs(i - gapCenter) >= skipRadius) indices.push(i);
    const cap = this.finalBossBulletCap();
    if (this.enemyBullets.length > cap - indices.length) return false;
    const speed = this.tuning.enemyBulletSpeed * (this.difficulty === 'hard' ? 1.16 : this.difficulty === 'medium' ? 1.08 : 1.00);
    this.effects.push({ x: boss.x, y: boss.y + 0.085, age: 0, duration: 0.20, kind: 'enemyMuzzle', enemyType: 'finalBoss', charged: true });
    for (const i of indices) {
      const t = i / Math.max(1, count - 1);
      const angle = lerp(-arc, arc, t);
      this.enemyBullets.push({
        x: boss.x,
        y: boss.y + 0.085,
        vx: Math.sin(angle) * speed,
        vy: Math.cos(angle) * speed,
        sprite: 'finalBossSpread',
        charged: true,
        trailColor: '#ff6fa4',
        sizeMul: 1.18
      });
    }
    return true;
  }

  runFinalBossScriptStep(boss, phase) {
    const script = this.finalBossScript;
    const cadence = this.difficulty === 'hard' ? 0.64 : this.difficulty === 'medium' ? 0.78 : 0.92;
    const step = script.step;
    let delay = 0.90;

    if (phase === 1) {
      switch (step % 8) {
        case 0: this.setFinalBossTarget(boss, 0.50); delay = 0.62; break;
        case 1: this.scheduleFinalBossAttack(boss, 'doubleAim', 0.46); delay = 1.05; break;
        case 2: this.setFinalBossTarget(boss, 0.27); delay = 0.70; break;
        case 3: this.scheduleFinalBossAttack(boss, 'straightLanes', 0.40); delay = 1.08; break;
        case 4: this.setFinalBossTarget(boss, 0.50); delay = 0.62; break;
        case 5: this.scheduleFinalBossAttack(boss, 'fiveFan', 0.44); delay = 1.12; break;
        case 6: this.setFinalBossTarget(boss, 0.73); delay = 0.70; break;
        case 7: this.scheduleFinalBossAttack(boss, 'doubleAim', 0.46); delay = 1.18; break;
      }
    } else if (phase === 2) {
      switch (step % 8) {
        case 0: this.setFinalBossTarget(boss, 0.24); delay = 0.56; break;
        case 1: this.scheduleFinalBossAttack(boss, 'sevenSpread', 0.40); delay = 0.98; break;
        case 2: this.setFinalBossTarget(boss, 0.76); delay = 0.58; break;
        case 3: this.scheduleFinalBossAttack(boss, 'alternatingArc', 0.38, { bias: -0.10 }); delay = 0.96; break;
        case 4: this.setFinalBossTarget(boss, 0.50); delay = 0.54; break;
        case 5: {
          script.safeGapSide *= -1;
          this.scheduleFinalBossAttack(boss, 'safeGap', 0.48, { safeGapSide: script.safeGapSide });
          delay = 1.10;
          break;
        }
        case 6: this.setFinalBossTarget(boss, script.safeGapSide < 0 ? 0.68 : 0.32); delay = 0.56; break;
        case 7: this.scheduleFinalBossAttack(boss, 'alternatingArc', 0.38, { bias: 0.10 }); delay = 1.02; break;
      }
    } else {
      switch (step % 9) {
        case 0: {
          script.laserSide *= -1;
          const targetX = clamp(this.player.x + script.laserSide * 0.10, 0.10, 0.90);
          this.setFinalBossTarget(boss, targetX < 0.5 ? 0.72 : 0.28);
          delay = 0.56;
          break;
        }
        case 1: {
          const targetX = clamp(this.player.x + script.laserSide * 0.10, 0.10, 0.90);
          this.scheduleFinalBossAttack(boss, 'laser', 0.18, { targetX });
          delay = 1.72;
          break;
        }
        case 2: this.setFinalBossTarget(boss, 0.50); delay = 0.50; break;
        case 3: {
          script.safeGapSide *= -1;
          this.scheduleFinalBossAttack(boss, 'safeGap', 0.40, { safeGapSide: script.safeGapSide });
          delay = 1.02;
          break;
        }
        case 4: this.scheduleFinalBossAttack(boss, 'aimedBurst', 0.40); delay = 0.96; break;
        case 5: this.setFinalBossTarget(boss, script.laserSide < 0 ? 0.74 : 0.26); delay = 0.54; break;
        case 6: this.scheduleFinalBossAttack(boss, 'alternatingArc', 0.36, { bias: script.laserSide * 0.08 }); delay = 0.94; break;
        case 7: this.scheduleFinalBossAttack(boss, 'doubleAim', 0.38); delay = 0.92; break;
        case 8: this.setFinalBossTarget(boss, 0.50); delay = 0.58; break;
      }
    }

    script.step += 1;
    script.timer = delay * cadence;
  }

  updateFinalBossFight(dt) {
    const boss = this.finalBoss();
    if (!boss) return;
    const phase = this.finalBossPhase(boss);
    if (boss.bossPhase !== phase) {
      boss.bossPhase = phase;
      this.finalBossScript = {
        phase,
        step: 0,
        timer: phase === 3 ? 0.95 : 0.82,
        safeGapSide: this.finalBossScript?.safeGapSide || -1,
        laserSide: this.finalBossScript?.laserSide || -1
      };
      boss.pendingBossAttack = null;
      this.bossLaser = null;
      this.enemyBullets = this.enemyBullets.filter((bullet) => bullet.y < 0.28);
      this.bossPhaseBurstTimer = 0.90;
      const phaseLabel = phase === 1 ? 'POSITIONING' : phase === 2 ? 'DODGE' : 'MASTERY';
      this.patternBanner = { label: `BOSS PHASE ${phase} • ${phaseLabel}`, timer: 1.5 };
      this.triggerShake(phase === 3 ? 1.0 : 0.72, phase === 3 ? 0.38 : 0.28);
      this.triggerVisualFreeze(phase === 3 ? 0.085 : 0.055);
      this.emitVfx('boss-phase', { phase, hp: boss.hp, maxHp: boss.maxHp, label: phaseLabel });
    }

    if (boss.pendingBossAttack) {
      boss.pendingBossAttack.timer = Math.max(0, Number(boss.pendingBossAttack.timer || 0) - dt);
      if (boss.pendingBossAttack.timer <= 0) {
        const attack = boss.pendingBossAttack;
        boss.pendingBossAttack = null;
        this.executeFinalBossAttack(boss, attack);
      }
    }

    if (Number(boss.spawnAge || 0) < Number(boss.spawnDuration || 0) + 0.55) return;
    this.finalBossScript.timer -= dt * (this.enraged ? 1.06 : 1);
    if (this.finalBossScript.timer <= 0 && !boss.pendingBossAttack && !this.bossLaser) this.runFinalBossScriptStep(boss, phase);
  }

  updateBossSpecials(dt) {
    this.updateMiniBossFight(dt);
    this.updateFinalBossFight(dt);

    if (!this.bossLaser) return;
    if (this.bossLaser.telegraph > 0) {
      const beforeTelegraph = this.bossLaser.telegraph;
      this.bossLaser.telegraph = Math.max(0, this.bossLaser.telegraph - dt);
      if (beforeTelegraph > 0 && this.bossLaser.telegraph <= 0) {
        this.bossLaserFireFlashTimer = 0.22;
        this.triggerShake(0.46, 0.16);
        this.triggerVisualFreeze(0.035);
        this.emitAudio('boss-laser-fire', { x: this.bossLaser.x, width: this.bossLaser.width });
        this.emitVfx('boss-laser-fire', { x: this.bossLaser.x, width: this.bossLaser.width });
      }
      return;
    }
    this.bossLaser.active = Math.max(0, this.bossLaser.active - dt);
    if (!this.bossLaser.hitApplied && this.bossLaser.active > 0 && this.player.respawnTimer <= 0 && this.player.invulnerabilityTimer <= 0) {
      if (Math.abs(this.player.x - this.bossLaser.x) <= this.bossLaser.width) {
        this.bossLaser.hitApplied = true;
        this.damagePlayer();
      }
    }
    if (this.bossLaser.active <= 0) this.bossLaser = null;
  }

  startBossLaser(targetX = this.player.x) {
    if (this.bossLaser) return false;
    const telegraph = this.difficulty === 'hard' ? 0.72 : this.difficulty === 'medium' ? 0.86 : 1.02;
    this.bossLaser = {
      x: clamp(Number(targetX ?? this.player.x), 0.08, 0.92),
      width: this.difficulty === 'hard' ? 0.072 : this.difficulty === 'medium' ? 0.064 : 0.055,
      telegraph,
      telegraphDuration: telegraph,
      active: this.difficulty === 'hard' ? 0.54 : this.difficulty === 'medium' ? 0.50 : 0.46,
      hitApplied: false
    };
    this.patternBanner = { label: 'LASER • MOVE!', timer: Math.min(1.0, telegraph) };
    this.emitAudio('boss-laser-telegraph', { targetX: this.bossLaser.x, telegraph });
    this.emitVfx('boss-laser-telegraph', { targetX: this.bossLaser.x, width: this.bossLaser.width, telegraph });
    return true;
  }

  cleanupFinalBossAdds(bossId) {
    // Gameplay Patch 4: Wave 10 is a solo encounter. This cleanup is defensive only;
    // any unexpected non-boss entity is removed instead of becoming part of the fight.
    for (const other of this.enemies) {
      if (!other.alive || other.id === bossId) continue;
      other.alive = false;
      other.mode = 'dead';
    }
    this.enemyBullets = [];
    this.bossLaser = null;
  }

  updateCombo(dt) {
    if (this.comboIndex <= 0) return;
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0) this.comboIndex = 0;
  }

  currentCombo() {
    return this.comboSteps[this.comboIndex] || 1;
  }

  updatePlayer(dt) {
    if (this.player.respawnTimer > 0) {
      this.player.respawnTimer -= dt;
      if (this.player.respawnTimer <= 0 && this.player.lives > 0) {
        this.player.respawnTimer = 0;
        this.player.invulnerabilityTimer = 2;
        this.player.x = 0.5;
        this.player.y = 0.865;
        if (this.playerVfx) {
          this.playerVfx.lastX = this.player.x;
          this.playerVfx.visualVx = 0;
          this.playerVfx.tilt = 0;
        }
      }
      return;
    }

    if (this.player.invulnerabilityTimer > 0) {
      this.player.invulnerabilityTimer = Math.max(0, this.player.invulnerabilityTimer - dt);
    }

    let direction = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) direction -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) direction += 1;
    this.player.x = clamp(this.player.x + direction * this.tuning.playerSpeed * dt, 0.055, 0.945);

    this.playerFireClock = Math.max(0, this.playerFireClock - dt);
    const wantsFire = this.touchMode || this.keys.has(' ');
    if (wantsFire && this.playerFireClock <= 0) {
      this.firePlayerBullet();
      const baseInterval = this.touchMode ? this.tuning.autoFireInterval : 0.18;
      this.playerFireClock = this.overdriveTimer > 0 ? baseInterval / 1.2 : baseInterval;
    }
  }

  updatePlayerVfx(dt) {
    const vfx = this.playerVfx;
    if (!vfx) return;

    const dx = this.player.x - vfx.lastX;
    const rawVelocity = dt > 0.00001 ? dx / dt : 0;
    vfx.lastX = this.player.x;
    const smoothing = 1 - Math.exp(-dt * (this.reducedMotion ? 18 : 12));
    vfx.visualVx = lerp(vfx.visualVx, clamp(rawVelocity, -1.5, 1.5), smoothing);
    const targetTilt = this.reducedMotion ? 0 : clamp(vfx.visualVx * 0.16, -0.18, 0.18);
    vfx.tilt = lerp(vfx.tilt, targetTilt, 1 - Math.exp(-dt * 13));
    vfx.recoilTimer = Math.max(0, vfx.recoilTimer - dt);
    vfx.muzzleTimer = Math.max(0, vfx.muzzleTimer - dt);
    vfx.hitTimer = Math.max(0, vfx.hitTimer - dt);

    // Patch 4: Patch 3 stopped drawing these histories on Safari, but the old
    // update path still allocated trail/particle objects and replacement arrays
    // every frame. Stop that hidden GC pressure at the source.
    if (this.safariPortrait) {
      if (vfx.trailPoints.length) vfx.trailPoints.length = 0;
      if (this.thrusterParticles.length) this.thrusterParticles.length = 0;
      vfx.trailClock = 0;
      vfx.thrusterClock = 0;
      return;
    }

    // VFX Patch 2: retain a short presentation-only history so the player ship
    // leaves a readable cyan engine ribbon that bends with lateral movement.
    const adaptiveLevel = this.mobilePortrait ? this.adaptiveVfxLevel : 0;
    const portraitTrailLife = adaptiveLevel >= 2 ? 0.12 : adaptiveLevel === 1 ? 0.15 : 0.18;
    const portraitTrailCap = adaptiveLevel >= 2 ? 3 : adaptiveLevel === 1 ? 4 : 5;
    const adaptiveIntervalScale = adaptiveLevel >= 2 ? 1.75 : adaptiveLevel === 1 ? 1.35 : 1;

    vfx.trailClock -= dt;
    for (const point of vfx.trailPoints || []) point.age += dt;
    vfx.trailPoints = (vfx.trailPoints || []).filter((point) => point.age < (this.mobilePortrait ? portraitTrailLife : 0.24)).slice(0, this.mobilePortrait ? portraitTrailCap + 1 : 10);
    if (this.player.lives > 0 && this.player.respawnTimer <= 0 && vfx.trailClock <= 0) {
      vfx.trailPoints.unshift({
        x: this.player.x,
        y: this.player.y,
        tilt: vfx.tilt,
        age: 0,
        overdrive: this.overdriveTimer > 0
      });
      vfx.trailPoints = vfx.trailPoints.slice(0, this.reducedMotion ? 4 : (this.mobilePortrait ? portraitTrailCap : 9));
      const baseTrailInterval = this.mobilePortrait && this.overdriveTimer > 0 ? 0.055 : (this.overdriveTimer > 0 ? 0.038 : 0.048);
      vfx.trailClock = this.reducedMotion ? 0.065 : (this.mobilePortrait ? baseTrailInterval * adaptiveIntervalScale : (this.overdriveTimer > 0 ? 0.020 : 0.030));
    }

    vfx.thrusterClock -= dt;
    if (this.player.lives > 0 && this.player.respawnTimer <= 0 && vfx.thrusterClock <= 0) {
      const count = this.reducedMotion || this.mobilePortrait ? 1 : (this.overdriveTimer > 0 ? 2 : 1);
      for (let i = 0; i < count; i += 1) {
        this.thrusterParticles.push({
          x: this.player.x + (this.random() - 0.5) * 0.018,
          y: this.player.y + 0.046 + this.random() * 0.010,
          vx: -vfx.visualVx * 0.012 + (this.random() - 0.5) * 0.018,
          vy: 0.10 + this.random() * (this.overdriveTimer > 0 ? 0.14 : 0.09),
          age: 0,
          duration: this.reducedMotion ? 0.16 : 0.22 + this.random() * 0.16,
          size: 0.65 + this.random() * 0.65,
          overdrive: this.overdriveTimer > 0
        });
      }
      const baseThrusterInterval = this.mobilePortrait && this.overdriveTimer > 0 ? 0.058 : (this.overdriveTimer > 0 ? 0.036 : 0.052);
      vfx.thrusterClock = this.reducedMotion ? 0.06 : (this.mobilePortrait ? baseThrusterInterval * adaptiveIntervalScale : (this.overdriveTimer > 0 ? 0.018 : 0.032));
    }

    for (const particle of this.thrusterParticles) {
      particle.age += dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
    const portraitThrusterCap = adaptiveLevel >= 2 ? 16 : adaptiveLevel === 1 ? 24 : 34;
    this.thrusterParticles = this.thrusterParticles
      .filter((particle) => particle.age < particle.duration && particle.y < 1.08)
      .slice(-(this.mobilePortrait ? portraitThrusterCap : 70));
  }

  firePlayerBullet() {
    if (this.player.respawnTimer > 0 || this.player.lives <= 0) return;
    const active = this.overdriveTimer > 0;
    const count = active ? 2 : 1;
    if (this.playerBullets.length >= (active ? 8 : 4)) return;
    const offsets = count === 2 ? [-0.018, 0.018] : [0];
    for (const offset of offsets) {
      this.playerBullets.push({
        x: this.player.x + offset,
        y: this.player.y - 0.055,
        vx: offset * 0.25,
        vy: -1.22,
        sprite: active ? 'playerBulletOverdrive' : 'playerBullet',
        pierce: active ? 1 : 0,
        hitIds: []
      });
      this.stats.shotsFired += 1;
    }
    if (this.playerVfx) {
      this.playerVfx.muzzleTimer = active ? 0.10 : 0.075;
      this.playerVfx.recoilTimer = active ? 0.11 : 0.085;
    }
    this.emitAudio('player-fire', { overdrive: active, count });
  }

  getAliveEnemies() {
    return this.enemies.filter((enemy) => enemy.alive);
  }

  isBossWave() {
    return Boolean(this.waveDef.final || this.enemies.some((enemy) => enemy.alive && ['miniBoss', 'finalBoss'].includes(enemy.type)));
  }

  hasActiveAttackers() {
    return this.enemies.some((enemy) => enemy.alive && !['formation', 'dead'].includes(enemy.mode) && enemy.type !== 'finalBoss');
  }

  regularEnemyInitialCount() {
    const formationCount = (this.waveDef.formation || []).filter((slot) => !['miniBoss', 'finalBoss'].includes(slot.type)).length;
    return Math.max(0, formationCount || (this.isBossWave() ? 0 : Number(this.waveDef.enemyCount || 0)));
  }

  updateLastStandState() {
    if (this.lastStandActive || this.isBossWave() || this.waveClearPending) return;
    const initial = this.regularEnemyInitialCount();
    if (initial < 4) return;
    const alive = this.getAliveEnemies().filter((enemy) => !['miniBoss', 'finalBoss'].includes(enemy.type)).length;
    const threshold = Math.max(1, Math.ceil(initial * LAST_STAND_THRESHOLD));
    if (alive <= 0 || alive > threshold) return;
    this.lastStandActive = true;
    this.patternBanner = { label: 'LAST STAND', timer: 1.05 };
    this.triggerShake(0.20, 0.12);
    this.emitVfx('last-stand', { alive, initial, threshold });
  }

  isDangerKill(enemy) {
    return Boolean(enemy?.alive && !['miniBoss', 'finalBoss'].includes(enemy.type) && !['formation', 'dead'].includes(enemy.mode));
  }

  getWavePressure() {
    const initialRegular = Math.max(1, (this.waveDef.formation || []).filter((slot) => !['miniBoss', 'finalBoss'].includes(slot.type)).length || Number(this.waveDef.enemyCount || 1));
    const aliveRegular = this.getAliveEnemies().filter((enemy) => !['miniBoss', 'finalBoss'].includes(enemy.type)).length;
    const killPressure = clamp(1 - aliveRegular / initialRegular, 0, 1);
    const timeCap = Math.max(1, Number(this.waveDef.timeCap || 45));
    const timePressure = clamp((this.waveElapsed - timeCap * 0.55) / (timeCap * 0.45), 0, 1);
    return clamp(Math.max(killPressure, timePressure * 0.82, this.enraged ? 0.92 : 0), 0, 1);
  }

  regularThreatLimit() {
    // Patch 7: Easy now behaves like a Medium+ baseline, Medium like the old
    // Hard pressure model, and Hard can sustain the most stacked channels.
    if (this.difficulty === 'hard') return this.currentWave <= 2 ? 2 : this.currentWave <= 5 ? 3 : 4;
    if (this.difficulty === 'medium') return this.currentWave <= 2 ? 2 : 3;
    return this.currentWave <= 2 ? 1 : 2;
  }

  activePatternThreats() {
    return this.hasActiveAttackers() ? 1 : 0;
  }

  availableFireTokens() {
    if (Number(this.recoveryTimer || 0) > 0) return 0;
    const configured = Math.max(0, Number(this.waveDef.fireTokens ?? (this.currentWave >= 4 ? 2 : 1)));
    if (!configured) return 0;
    const remainingThreatChannels = Math.max(0, this.regularThreatLimit() - this.activePatternThreats());
    if (this.currentWave <= 2 && this.difficulty === 'easy' && this.hasActiveAttackers()) return 0;
    return Math.min(configured, remainingThreatChannels);
  }

  enemyBulletCap() {
    const portrait = this.canvas.height >= this.canvas.width;
    const waveBase = this.currentWave <= 2 ? 12 : this.currentWave <= 4 ? 16 : this.currentWave <= 6 ? 18 : 22;
    const difficultyAdd = this.difficulty === 'hard' ? 7 : this.difficulty === 'medium' ? 5 : 0;
    const portraitFactor = portrait ? 0.84 : 1;
    return Math.max(8, Math.round((waveBase + difficultyAdd) * portraitFactor));
  }

  canStartPattern(patternId) {
    const alive = this.getAliveEnemies().filter((enemy) => !['miniBoss', 'finalBoss'].includes(enemy.type));
    const divers = alive.filter((enemy) => enemy.type === 'diver' && enemy.mode === 'formation');
    const shooters = alive.filter((enemy) => enemy.type === 'shooter' && enemy.mode === 'formation');
    const chargers = alive.filter((enemy) => enemy.type === 'charger' && enemy.mode === 'formation');
    const elites = alive.filter((enemy) => enemy.type === 'elite' && enemy.mode === 'formation');
    const formation = alive.filter((enemy) => enemy.mode === 'formation');
    const pincerUnits = formation.filter((enemy) => ['diver', 'elite'].includes(enemy.type));
    const swarmUnits = formation.filter((enemy) => ['fighter', 'diver'].includes(enemy.type));
    if (['singleDive', 'twinDive', 'zigzag', 'spiral'].includes(patternId)) return divers.length >= (patternId === 'singleDive' || patternId === 'zigzag' ? 1 : 2);
    if (patternId === 'pincer') return pincerUnits.some((enemy) => enemy.x < 0.5) && pincerUnits.some((enemy) => enemy.x >= 0.5);
    if (patternId === 'crossfire') return shooters.length >= 2;
    if (patternId === 'swarm') return swarmUnits.length >= 3;
    if (patternId === 'charge') return chargers.length >= 1;
    if (patternId === 'eliteAssault') return elites.length >= 1;
    return false;
  }

  pick(list, count) {
    const pool = [...list];
    const result = [];
    while (pool.length && result.length < count) {
      const index = Math.floor(this.random() * pool.length);
      result.push(pool.splice(index, 1)[0]);
    }
    return result;
  }

  startPattern(patternId) {
    const alive = this.getAliveEnemies().filter((enemy) => !['miniBoss', 'finalBoss'].includes(enemy.type));
    const divers = alive.filter((enemy) => enemy.type === 'diver' && enemy.mode === 'formation');
    const shooters = alive.filter((enemy) => enemy.type === 'shooter' && enemy.mode === 'formation');
    const chargers = alive.filter((enemy) => enemy.type === 'charger' && enemy.mode === 'formation');
    const elites = alive.filter((enemy) => enemy.type === 'elite' && enemy.mode === 'formation');
    const formation = alive.filter((enemy) => enemy.mode === 'formation');
    const pincerUnits = formation.filter((enemy) => ['diver', 'elite'].includes(enemy.type));
    const swarmUnits = formation.filter((enemy) => ['fighter', 'diver'].includes(enemy.type));

    if (patternId === 'singleDive') {
      const [enemy] = this.pick(divers, 1);
      if (!enemy) return false;
      const side = enemy.x < 0.5 ? -1 : 1;
      const targetX = clamp(this.player.x, 0.12, 0.88);
      return this.launchAttack(enemy, 'dive', { side, targetX });
    }
    if (patternId === 'twinDive') {
      const leftPool = divers.filter((enemy) => enemy.x < 0.5);
      const rightPool = divers.filter((enemy) => enemy.x >= 0.5);
      let selected = [];
      if (leftPool.length && rightPool.length) {
        selected = [this.pick(leftPool, 1)[0], this.pick(rightPool, 1)[0]].filter(Boolean);
      } else {
        selected = this.pick(divers, 2).sort((a, b) => a.x - b.x);
      }
      if (selected.length < 2) return false;

      const targetCenter = clamp(this.player.x, 0.16, 0.84);
      selected.forEach((enemy, index) => {
        // Prefer the enemy's authored side. If both divers came from one side,
        // split the pair so the two routes never stack on top of each other.
        let side = enemy.x < 0.5 ? -1 : 1;
        if ((selected[0].x < 0.5) === (selected[1].x < 0.5)) side = index === 0 ? -1 : 1;
        const targetX = clamp(targetCenter + side * 0.035, 0.12, 0.88);
        this.launchAttack(enemy, 'dive', { side, targetX, delay: index * 0.14 });
      });
      return true;
    }
    if (patternId === 'zigzag') {
      const [enemy] = this.pick(divers, 1);
      return enemy ? this.launchAttack(enemy, 'zigzag', { side: enemy.x < 0.5 ? 1 : -1 }) : false;
    }
    if (patternId === 'pincer') {
      const left = pincerUnits.filter((enemy) => enemy.x < 0.5).sort((a, b) => a.x - b.x)[0];
      const right = pincerUnits.filter((enemy) => enemy.x >= 0.5).sort((a, b) => b.x - a.x)[0];
      if (!left || !right) return false;
      this.launchAttack(left, 'pincer', { side: -1 });
      this.launchAttack(right, 'pincer', { side: 1 });
      return true;
    }
    if (patternId === 'spiral') {
      const selected = this.pick(divers, 2);
      if (selected.length < 2) return false;
      selected.forEach((enemy, index) => this.launchAttack(enemy, 'spiral', { side: index === 0 ? -1 : 1, phaseOffset: index * Math.PI }));
      return true;
    }
    if (patternId === 'crossfire') {
      const selected = this.pick(shooters, 2);
      if (selected.length < 2) return false;
      selected.forEach((enemy, index) => this.launchAttack(enemy, 'crossfire', { side: index === 0 ? -1 : 1 }));
      return true;
    }
    if (patternId === 'swarm') {
      let pool = swarmUnits;
      const groups = [...new Set(swarmUnits.map((enemy) => enemy.formationGroup).filter(Boolean))];
      if (groups.length) {
        for (let offset = 0; offset < groups.length; offset += 1) {
          const group = groups[(this.swarmGroupCursor + offset) % groups.length];
          const groupPool = swarmUnits.filter((enemy) => enemy.formationGroup === group);
          if (groupPool.length >= 3) {
            pool = groupPool;
            this.swarmGroupCursor = (groups.indexOf(group) + 1) % groups.length;
            break;
          }
        }
      }
      const count = Math.min(this.difficulty === 'hard' ? 6 : this.difficulty === 'medium' ? 5 : 4, pool.length);
      const selected = [...pool].sort((a, b) => a.formationOrder - b.formationOrder).slice(0, count);
      if (selected.length < 3) return false;
      selected.forEach((enemy, index) => this.launchAttack(enemy, 'swarm', { lane: index, total: selected.length, delay: index * 0.10 }));
      return true;
    }
    if (patternId === 'charge') {
      const selected = this.pick(chargers, Math.min(this.difficulty === 'hard' ? 3 : 2, chargers.length));
      if (!selected.length) return false;
      selected.forEach((enemy, index) => this.launchAttack(enemy, 'charge', { targetX: clamp(this.player.x + (index ? 0.08 : -0.08), 0.08, 0.92), delay: index * 0.18 }));
      return true;
    }
    if (patternId === 'eliteAssault') {
      const selected = this.pick(elites, Math.min(this.difficulty === 'hard' ? 3 : 2, elites.length));
      if (!selected.length) return false;
      selected.forEach((enemy, index) => this.launchAttack(enemy, 'eliteAssault', { side: index % 2 ? 1 : -1, delay: index * 0.16 }));
      return true;
    }
    return false;
  }

  launchAttack(enemy, kind, params = {}) {
    if (!enemy || !enemy.alive || enemy.mode !== 'formation') return false;
    enemy.mode = 'attack';
    const baseTelegraph = kind === 'charge' ? 0.62 : kind === 'eliteAssault' ? 0.48 : 0.38;
    const telegraph = Math.max(0.24, baseTelegraph * Number(this.tuning.telegraphScale || 1));
    enemy.telegraphDuration = telegraph;
    enemy.telegraphTimer = telegraph;
    enemy.attackTime = -(Number(params.delay || 0) + telegraph);
    enemy.attackDuration = {
      dive: 2.5, zigzag: 3.0, pincer: 2.8, spiral: 3.2, crossfire: 2.6,
      swarm: 2.65, charge: 2.15, eliteAssault: 3.1
    }[kind] || 2.6;
    const frozenTargetX = Number(params.targetX ?? this.player.x);
    enemy.attack = {
      kind,
      ...params,
      startX: enemy.x,
      startY: enemy.y,
      returnX: enemy.baseX,
      returnY: enemy.baseY,
      targetX: frozenTargetX,
      targetY: this.player.y
    };
    enemy.fireCooldown = 0.25 + this.random() * 0.25;
    enemy.attackShots = 0;
    enemy.pendingBurst = null;
    enemy.trailPoints = [];
    enemy.trailClock = 0;
    this.effects.push({ x: enemy.x, y: enemy.y + 0.065, age: 0, duration: telegraph + 0.12, kind: 'warning', enemyType: enemy.type, attackKind: kind, targetX: Number(params.targetX ?? this.player.x), targetY: this.player.y });
    return true;
  }

  onPatternActivated(pattern, activations) {
    this.patternBanner = { label: pattern.label, timer: 1.15 };
    this.onPattern({ id: pattern.id, label: pattern.label, activations: { ...activations } });
    this.emitHud();
  }

  updateEnemies(dt) {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.spawnAge = Number(enemy.spawnAge || 0) + dt;
      enemy.hitFlashTimer = Math.max(0, Number(enemy.hitFlashTimer || 0) - dt);
      enemy.hpReadTimer = Math.max(0, Number(enemy.hpReadTimer || 0) - dt);
      enemy.telegraphTimer = Math.max(0, Number(enemy.telegraphTimer || 0) - dt);
      const previousX = enemy.x;
      const previousY = enemy.y;

      if (enemy.mode === 'formation') {
        if (enemy.type === 'miniBoss') {
          const targetX = clamp(Number(enemy.bossTargetX ?? 0.5), 0.20, 0.80);
          const follow = 1 - Math.exp(-dt * (this.miniBossPhase(enemy) === 2 ? 3.5 : 2.8));
          const hover = this.reducedMotion ? 0 : Math.sin(this.elapsed * 1.45) * 0.010;
          enemy.x = clamp(lerp(enemy.x, targetX + hover, follow), 0.18, 0.82);
          enemy.y = enemy.baseY + Math.sin(this.elapsed * 1.05) * 0.014;
        } else if (enemy.type === 'finalBoss') {
          const phase = this.finalBossPhase(enemy) || 1;
          const targetX = clamp(Number(enemy.bossTargetX ?? 0.5), 0.16, 0.84);
          const followRate = phase === 3 ? 3.25 : phase === 2 ? 2.75 : 2.20;
          const follow = 1 - Math.exp(-dt * followRate);
          const hover = this.reducedMotion ? 0 : Math.sin(this.elapsed * (phase === 3 ? 1.45 : 1.10)) * 0.012;
          enemy.x = clamp(lerp(enemy.x, targetX + hover, follow), 0.14, 0.86);
          enemy.y = enemy.baseY + Math.sin(this.elapsed * 0.96) * 0.016;
        } else {
          const enrageSpeed = this.enraged ? 1.25 : 1;
          const spec = ENEMY[enemy.type] || ENEMY.fighter;
          const typeSpeed = Number(spec.driftSpeed || 1);
          const lastStandSpeed = this.lastStandActive ? 1.12 : 1;
          const lastStandDrift = this.lastStandActive
            ? (enemy.type === 'fighter' ? 1.18 : enemy.type === 'shooter' ? 1.10 : 1.06)
            : 1;
          const driftX = Number(spec.driftX ?? 0.026) * lastStandDrift;
          const driftY = Number(spec.driftY ?? 0.007) * (this.lastStandActive ? 1.05 : 1);
          const lanePhase = enemy.formationLane.includes('right') ? Math.PI : 0;
          enemy.x = clamp(
            enemy.baseX + Math.sin(this.elapsed * this.tuning.formationSpeed * enrageSpeed * lastStandSpeed * typeSpeed + enemy.phase + lanePhase) * driftX,
            0.055,
            0.945
          );
          enemy.y = enemy.baseY + Math.sin(this.elapsed * (0.66 + typeSpeed * 0.08) * lastStandSpeed + enemy.phase) * driftY;
          enemy.fireCooldown = Math.max(0, Number(enemy.fireCooldown || 0) - dt);
        }
        enemy.rotation = Math.PI;
        continue;
      }

      this.updateAttackEnemy(enemy, dt);
      const attacking = Number(enemy.attackTime || 0) >= 0;
      if (this.safariPortrait) {
        // Patch 4: trails are not rendered in Safari portrait, so do not create,
        // age, filter or slice their backing arrays on the hot update path.
        if (enemy.trailPoints?.length) enemy.trailPoints.length = 0;
        enemy.trailClock = 0;
      } else {
        if (attacking && ['diver', 'charger', 'elite'].includes(enemy.type)) {
          enemy.trailClock = Number(enemy.trailClock || 0) - dt;
          if (enemy.trailClock <= 0) {
            const level = this.mobilePortrait ? this.adaptiveVfxLevel : 0;
            const intervalScale = level >= 2 ? 1.8 : level === 1 ? 1.35 : 1;
            enemy.trailClock = this.mobilePortrait
              ? (enemy.type === 'charger' ? 0.060 : 0.085) * intervalScale
              : (enemy.type === 'charger' ? 0.035 : 0.055);
            enemy.trailPoints ||= [];
            enemy.trailPoints.unshift({ x: enemy.x, y: enemy.y, rotation: enemy.rotation ?? Math.PI, age: 0 });
            const portraitCap = level >= 2 ? (enemy.type === 'charger' ? 2 : 1) : level === 1 ? (enemy.type === 'charger' ? 3 : 2) : (enemy.type === 'charger' ? 4 : 3);
            enemy.trailPoints = enemy.trailPoints.slice(0, this.mobilePortrait ? portraitCap : (enemy.type === 'charger' ? 7 : 5));
          }
        }
        for (const point of enemy.trailPoints || []) point.age += dt;
        const level = this.mobilePortrait ? this.adaptiveVfxLevel : 0;
        const portraitLife = level >= 2 ? 0.14 : level === 1 ? 0.18 : 0.22;
        enemy.trailPoints = (enemy.trailPoints || []).filter((point) => point.age < (this.mobilePortrait ? portraitLife : 0.32));
      }

      if (enemy.mode === 'formation') {
        enemy.rotation = Math.PI;
      } else {
        const dx = enemy.x - previousX;
        const dy = enemy.y - previousY;
        if (Math.hypot(dx, dy) > 0.00005) enemy.rotation = Math.atan2(dy, dx) + Math.PI / 2;
      }
    }
  }

  updateAttackEnemy(enemy, dt) {
    const pressureSpeed = 1 + this.getWavePressure() * 0.12;
    const lastStandAttackSpeed = this.lastStandActive ? 1.06 : 1;
    const previousAttackTime = Number(enemy.attackTime || 0);
    enemy.attackTime += dt * this.tuning.attackSpeed * pressureSpeed * lastStandAttackSpeed;
    if (enemy.attackTime < 0) return;
    const attack = enemy.attack;
    if (previousAttackTime < 0 && attack?.kind === 'dive') {
      this.emitAudio('dive-flyby', { enemyType: enemy.type, side: Number(attack.side || 1), x: enemy.x, y: enemy.y });
    }
    const t = clamp(enemy.attackTime / enemy.attackDuration, 0, 1);
    const side = Number(attack.side || 1);

    if (attack.kind === 'dive') {
      const point = diveRoutePoint(attack, t);
      enemy.x = point.x;
      enemy.y = point.y;
    } else if (attack.kind === 'zigzag') {
      enemy.x = clamp(attack.startX + Math.sin(t * Math.PI * 5) * 0.23 * side, 0.04, 0.96);
      enemy.y = attack.startY + Math.sin(t * Math.PI) * 0.62;
    } else if (attack.kind === 'pincer') {
      const targetX = side < 0 ? 0.68 : 0.32;
      const enter = Math.min(1, t * 1.7);
      const leave = Math.max(0, (t - 0.62) / 0.38);
      enemy.x = lerp(attack.startX, targetX, enter) + Math.sin(t * Math.PI * 2) * 0.035 * side;
      enemy.y = attack.startY + Math.sin(t * Math.PI) * 0.60;
      if (leave > 0) enemy.x = lerp(enemy.x, attack.startX, leave);
    } else if (attack.kind === 'spiral') {
      const angle = t * Math.PI * 5 + Number(attack.phaseOffset || 0);
      const radius = 0.08 + Math.sin(t * Math.PI) * 0.18;
      enemy.x = clamp(0.5 + Math.cos(angle) * radius, 0.04, 0.96);
      enemy.y = attack.startY + t * 0.53 + Math.sin(angle) * 0.09;
    } else if (attack.kind === 'crossfire') {
      const targetX = side < 0 ? 0.18 : 0.82;
      enemy.x = lerp(attack.startX, targetX, Math.sin(t * Math.PI));
      enemy.y = attack.startY + Math.sin(t * Math.PI) * 0.22;
      enemy.fireCooldown -= dt;
      if (enemy.fireCooldown <= 0 && t > 0.20 && t < 0.76 && this.enemyBullets.length < this.enemyBulletCap()) {
        const charged = enemy.attackShots >= 1;
        this.fireAimedEnemyBullet(enemy, charged, side * -0.055);
        enemy.attackShots += 1;
        const cadence = this.difficulty === 'hard' ? 0.34 : this.difficulty === 'medium' ? 0.42 : 0.50;
        enemy.fireCooldown = cadence;
      }
    } else if (attack.kind === 'swarm') {
      const lane = Number(attack.lane || 0);
      const total = Math.max(1, Number(attack.total || 1));
      const offset = (lane - (total - 1) / 2) * 0.11;
      enemy.x = clamp(0.5 + offset + Math.sin(t * Math.PI * 2 + lane) * 0.09, 0.04, 0.96);
      enemy.y = attack.startY + Math.sin(t * Math.PI) * 0.64;
    } else if (attack.kind === 'charge') {
      const targetX = Number(attack.targetX ?? this.player.x);
      const dive = Math.sin(t * Math.PI);
      enemy.x = lerp(attack.startX, targetX, Math.min(1, t * 1.35));
      enemy.y = attack.startY + dive * 0.69;
      if (t > 0.72) enemy.x = lerp(enemy.x, attack.startX, (t - 0.72) / 0.28);
    } else if (attack.kind === 'eliteAssault') {
      enemy.x = clamp(attack.startX + Math.sin(t * Math.PI * 4) * 0.19 * side, 0.05, 0.95);
      enemy.y = attack.startY + Math.sin(t * Math.PI) * 0.44;
      if (t > 0.22 && !enemy.pendingBurst && enemy.attackShots === 0) {
        this.queueEliteBurst(enemy, side * 0.045);
        enemy.attackShots = 1;
      }
      if (this.difficulty !== 'easy' && t > 0.62 && !enemy.pendingBurst && enemy.attackShots === 1) {
        this.queueEliteBurst(enemy, side * -0.035);
        enemy.attackShots = 2;
      }
    }

    if (enemy.type === 'diver' && ['dive', 'zigzag', 'pincer', 'spiral'].includes(attack.kind)) {
      enemy.fireCooldown -= dt;
      const maxDiveShots = this.difficulty === 'easy' && this.currentWave <= 2 ? 1 : 2;
      if (enemy.fireCooldown <= 0 && enemy.attackShots < maxDiveShots && t > 0.30 && t < 0.66 && this.enemyBullets.length < this.enemyBulletCap()) {
        this.fireAimedEnemyBullet(enemy, false);
        enemy.attackShots += 1;
        enemy.fireCooldown = 0.88 + this.random() * 0.28;
      }
    }

    if (t >= 1) this.returnToFormation(enemy);
  }

  startAttackRecovery(kind) {
    const duration = Number(RECOVERY_AFTER_ATTACK[String(kind || '')] || 0);
    if (duration <= 0 || this.isBossWave()) return;
    const difficultyScale = this.difficulty === 'hard' ? 0.55 : this.difficulty === 'medium' ? 0.72 : 0.90;
    this.recoveryTimer = Math.max(Number(this.recoveryTimer || 0), duration * difficultyScale);
  }

  returnToFormation(enemy) {
    const completedAttackKind = String(enemy?.attack?.kind || '');
    enemy.mode = 'formation';
    enemy.attack = null;
    enemy.attackTime = 0;
    enemy.x = enemy.baseX;
    enemy.y = enemy.baseY;
    enemy.fireCooldown = 0.7 + this.random() * 1.2;
    enemy.attackShots = 0;
    enemy.pendingBurst = null;
    enemy.telegraphTimer = 0;
    enemy.telegraphDuration = 0;
    enemy.trailPoints = [];
    enemy.rotation = Math.PI;
    this.startAttackRecovery(completedAttackKind);
  }

  updatePlayerBullets(dt) {
    let write = 0;
    for (let i = 0; i < this.playerBullets.length; i += 1) {
      const bullet = this.playerBullets[i];
      bullet.age = Number(bullet.age || 0) + dt;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (this.safariPortrait) {
        if (bullet.y > -0.08 && bullet.x > -0.08 && bullet.x < 1.08) this.playerBullets[write++] = bullet;
      }
    }
    if (this.safariPortrait) this.playerBullets.length = write;
    else this.playerBullets = this.playerBullets.filter((bullet) => bullet.y > -0.08 && bullet.x > -0.08 && bullet.x < 1.08);
  }

  updateEnemyBullets(dt) {
    let write = 0;
    for (let i = 0; i < this.enemyBullets.length; i += 1) {
      const bullet = this.enemyBullets[i];
      bullet.age = Number(bullet.age || 0) + dt;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (this.safariPortrait) {
        if (bullet.y < 1.08 && bullet.y > -0.1 && bullet.x > -0.12 && bullet.x < 1.12) this.enemyBullets[write++] = bullet;
      }
    }
    if (this.safariPortrait) this.enemyBullets.length = write;
    else this.enemyBullets = this.enemyBullets.filter((bullet) => bullet.y < 1.08 && bullet.y > -0.1 && bullet.x > -0.12 && bullet.x < 1.12);
  }

  updateEnemyShotTelegraphs(dt) {
    for (const enemy of this.enemies) {
      if (!enemy?.alive) continue;

      if (enemy.pendingBurst) {
        enemy.pendingBurst.timer = Math.max(0, Number(enemy.pendingBurst.timer || 0) - dt);
        if (enemy.pendingBurst.timer <= 0) {
          const burst = enemy.pendingBurst;
          const shot = burst.shots.shift();
          if (shot) {
            if (shot.lead) this.fireLeadEnemyBullet(enemy, Boolean(shot.charged), Number(shot.xBias || 0));
            else this.fireAimedEnemyBullet(enemy, Boolean(shot.charged), Number(shot.xBias || 0), { immediate: true });
          }
          if (burst.shots.length) {
            burst.timer = Number(burst.shots[0].delay || 0.12);
          } else {
            enemy.pendingBurst = null;
          }
        }
      }

      if (!enemy.pendingShot) continue;
      enemy.pendingShot.timer = Math.max(0, Number(enemy.pendingShot.timer || 0) - dt);
      if (enemy.pendingShot.timer > 0) continue;
      const shot = enemy.pendingShot;
      enemy.pendingShot = null;
      this.fireAimedEnemyBullet(enemy, shot.charged, shot.xBias, { immediate: true });
    }
  }

  startEnemyShotTelegraph(enemy, charged = true, xBias = 0) {
    if (!enemy?.alive || enemy.pendingShot || enemy.pendingBurst) return false;
    const duration = enemy.type === 'elite' ? 0.30 : 0.40;
    enemy.pendingShot = { timer: duration, duration, charged, xBias };
    this.effects.push({
      x: enemy.x, y: enemy.y + 0.045, age: 0, duration: duration + 0.06, kind: 'shotCharge',
      enemyType: enemy.type, targetX: this.player.x, targetY: this.player.y
    });
    return true;
  }

  queueEliteBurst(enemy, xBias = 0) {
    if (!enemy?.alive || enemy.pendingBurst || enemy.pendingShot) return false;
    const telegraph = 0.26;
    enemy.pendingBurst = {
      timer: telegraph,
      shots: [
        { delay: 0.12, charged: false, xBias: xBias - 0.02 },
        { delay: 0.14, charged: false, xBias: xBias + 0.02 },
        { delay: 0.18, charged: true, xBias, lead: true }
      ]
    };
    this.effects.push({
      x: enemy.x, y: enemy.y + 0.045, age: 0, duration: telegraph + 0.08, kind: 'shotCharge',
      enemyType: enemy.type, targetX: this.player.x, targetY: this.player.y
    });
    return true;
  }

  pickFireEmitters(candidates, count) {
    const pool = [...candidates];
    const chosen = [];
    const roleWeight = { shooter: 5, elite: 4.5, heavy: 3, fighter: 1.5 };
    while (pool.length && chosen.length < count) {
      const total = pool.reduce((sum, enemy) => sum + Number(roleWeight[enemy.type] || 1), 0);
      let roll = this.random() * Math.max(0.0001, total);
      let selectedIndex = 0;
      for (let index = 0; index < pool.length; index += 1) {
        roll -= Number(roleWeight[pool[index].type] || 1);
        if (roll <= 0) { selectedIndex = index; break; }
      }
      chosen.push(pool.splice(selectedIndex, 1)[0]);
    }
    return chosen;
  }

  fireStraightEnemyBullet(enemy, xVelocity = 0, speedScale = 1) {
    if (!enemy?.alive || this.enemyBullets.length >= this.enemyBulletCap()) return false;
    const speed = this.tuning.enemyBulletSpeed * speedScale;
    this.effects.push({ x: enemy.x, y: enemy.y + 0.045, age: 0, duration: 0.11, kind: 'enemyMuzzle', enemyType: enemy.type, charged: false });
    this.enemyBullets.push({
      x: enemy.x, y: enemy.y + 0.045,
      vx: Number(xVelocity || 0) * speed,
      vy: speed,
      sprite: enemy.type === 'fighter' ? 'fighterBullet' : enemy.type === 'heavy' ? 'heavyBullet' : 'fighterBullet',
      charged: false
    });
    return true;
  }

  fireHeavySpread(enemy) {
    if (!enemy?.alive) return false;
    const cap = this.enemyBulletCap();
    if (this.enemyBullets.length >= cap - 2) return false;
    const speed = this.tuning.enemyBulletSpeed * 0.78;
    const angles = [-0.20, 0, 0.20];
    this.effects.push({ x: enemy.x, y: enemy.y + 0.055, age: 0, duration: 0.15, kind: 'enemyMuzzle', enemyType: enemy.type, charged: false });
    for (const angle of angles) {
      this.enemyBullets.push({
        x: enemy.x, y: enemy.y + 0.055,
        vx: Math.sin(angle) * speed,
        vy: Math.cos(angle) * speed,
        sprite: 'heavyBullet', charged: false
      });
    }
    return true;
  }

  fireByEnemyRole(enemy) {
    if (!enemy?.alive || enemy.mode !== 'formation') return false;
    if (enemy.type === 'diver' || enemy.type === 'charger') return false;

    if (enemy.type === 'fighter') {
      const slight = (this.random() - 0.5) * 0.10;
      return this.fireStraightEnemyBullet(enemy, slight, 0.92);
    }
    if (enemy.type === 'shooter') {
      const charged = this.random() < this.tuning.shooterChargeChance;
      return this.fireAimedEnemyBullet(enemy, charged);
    }
    if (enemy.type === 'heavy') return this.fireHeavySpread(enemy);
    if (enemy.type === 'elite') return this.queueEliteBurst(enemy, (this.player.x - enemy.x) * 0.04);
    return false;
  }

  updateEnemyFire(dt) {
    const finalBoss = this.finalBoss();
    // Gameplay Patch 4: Final Boss firing is fully driven by its phase script.
    if (finalBoss) return;

    const miniBoss = this.miniBoss();
    // Gameplay Patch 3: Wave 5 is fully script-driven. Do not fall through to the
    // regular formation fire director while the Mini Boss is alive.
    if (miniBoss) return;

    this.enemyFireClock -= dt * (this.enraged ? 1.16 : 1) * (this.lastStandActive ? 1.08 : 1);
    if (this.enemyFireClock > 0 || this.enemyBullets.length >= this.enemyBulletCap()) return;

    const tokens = this.availableFireTokens();
    if (tokens <= 0) {
      this.enemyFireClock = 0.20;
      return;
    }

    const formation = this.enemies.filter((enemy) =>
      enemy.alive &&
      enemy.mode === 'formation' &&
      Number(enemy.spawnAge || 0) >= Number(enemy.spawnDuration || 0) &&
      Number(enemy.fireCooldown || 0) <= 0 &&
      !enemy.pendingShot && !enemy.pendingBurst &&
      ['fighter', 'shooter', 'heavy', 'elite'].includes(enemy.type)
    );
    if (!formation.length) {
      this.enemyFireClock = 0.24;
      return;
    }

    const emitters = this.pickFireEmitters(formation, tokens);
    for (const enemy of emitters) {
      if (!this.fireByEnemyRole(enemy)) continue;
      this.emitAudio('enemy-fire', { enemyType: enemy.type });
      const cooldownByType = {
        fighter: 1.55,
        shooter: 1.35,
        heavy: 1.85,
        elite: 2.15
      };
      const diffFactor = this.difficulty === 'hard' ? 0.70 : this.difficulty === 'medium' ? 0.82 : 0.94;
      const lastStandCooldown = this.lastStandActive
        ? (enemy.type === 'shooter' ? 0.90 : enemy.type === 'fighter' ? 0.95 : 0.97)
        : 1;
      enemy.fireCooldown = Number(cooldownByType[enemy.type] || 1.5) * diffFactor * lastStandCooldown * (0.88 + this.random() * 0.28);
    }

    this.fireCycle += 1;
    const pressure = this.getWavePressure();
    const jitter = 0.86 + this.random() * 0.30;
    const pressureFactor = 1 - pressure * 0.26;
    this.enemyFireClock = Math.max(0.42, this.tuning.enemyFireInterval * jitter * pressureFactor);
  }

  fireLeadEnemyBullet(enemy, charged = true, xBias = 0) {
    if (!enemy?.alive || this.enemyBullets.length >= this.enemyBulletCap()) return false;
    const lead = clamp(Number(this.playerVfx?.visualVx || 0) * 0.075, -0.12, 0.12);
    return this.fireAimedEnemyBullet(enemy, charged, xBias + lead, { immediate: true });
  }

  fireAimedEnemyBullet(enemy, charged = false, xBias = 0, options = {}) {
    const cap = ['miniBoss', 'finalBoss'].includes(enemy?.type) ? 30 : this.enemyBulletCap();
    if (!enemy?.alive || this.enemyBullets.length >= cap) return false;
    if (charged && ['shooter', 'elite'].includes(enemy.type) && !options.immediate) {
      return this.startEnemyShotTelegraph(enemy, charged, xBias);
    }
    const dx = (this.player.x - enemy.x) + xBias;
    const dy = Math.max(0.18, this.player.y - enemy.y);
    const mag = Math.hypot(dx, dy) || 1;
    const speed = this.tuning.enemyBulletSpeed * (charged ? 1.14 : 1);
    let sprite = 'fighterBullet';
    if (enemy.type === 'shooter') sprite = charged ? 'shooterCharged' : 'shooterBullet';
    else if (enemy.type === 'diver') sprite = 'diverBullet';
    else if (enemy.type === 'heavy') sprite = 'heavyBullet';
    else if (enemy.type === 'elite') sprite = charged ? 'eliteSpecial' : 'eliteBullet';
    else if (enemy.type === 'finalBoss') sprite = charged ? 'finalBossSpread' : 'finalBossBullet';
    this.effects.push({ x: enemy.x, y: enemy.y + 0.045, age: 0, duration: charged ? 0.18 : 0.11, kind: 'enemyMuzzle', enemyType: enemy.type, charged });
    this.enemyBullets.push({ x: enemy.x, y: enemy.y + 0.045, vx: (dx / mag) * speed, vy: (dy / mag) * speed, sprite, charged });
  }


  updateFormationLifecycle(dt) {
    if (this.enemies.some((enemy) => enemy.alive)) {
      this.waveClearClock = 0;
      return;
    }
    if (this.waveClearSent) return;
    this.waveClearPending = true;
    this.waveClearClock += dt;
    if (this.waveClearClock >= 1.1) this.completeWave();
  }

  completeWave() {
    if (this.waveClearSent) return;
    this.waveClearSent = true;
    const waveShots = Math.max(0, this.stats.shotsFired - this.waveStart.shotsFired);
    const waveHits = Math.max(0, this.stats.shotsHit - this.waveStart.shotsHit);
    const waveDamage = Math.max(0, this.stats.damageTaken - this.waveStart.damageTaken);
    const waveKills = Math.max(0, this.stats.kills - this.waveStart.kills);
    const accuracy = waveShots > 0 ? Math.round((waveHits / waveShots) * 10000) / 100 : 0;
    const combatScore = Math.max(0, this.score - this.waveStart.score);
    const accuracyRate = accuracyBonusRate(accuracy);
    const accuracyBonus = Math.round(combatScore * accuracyRate);
    const perfectBonus = waveDamage === 0 ? 1000 : 0;
    const aceBonus = waveDamage === 0 && accuracy > 90 && waveKills >= Number(this.waveDef.enemyCount || 0) ? 2500 : 0;
    this.score += accuracyBonus + perfectBonus + aceBonus;
    this.patternBanner = { label: `WAVE ${this.currentWave} CLEAR`, timer: 2.0 };
    const summary = {
      ...this.snapshot(),
      wave: this.currentWave,
      waveResult: {
        wave: this.currentWave,
        label: this.waveDef.label,
        combatScore,
        accuracy,
        accuracyRate,
        accuracyBonus,
        perfectBonus,
        aceBonus,
        waveKills,
        damageTaken: waveDamage,
        duration: Math.round(this.waveElapsed * 100) / 100,
        scoreAfterBonuses: this.score
      }
    };
    this.triggerShake(this.currentWave === 10 ? 1.1 : 0.48, this.currentWave === 10 ? 0.42 : 0.22);
    this.emitVfx('wave-clear', { result: summary.waveResult, final: this.currentWave === 10 });
    this.emitHud();
    this.onSnapshot(summary, { reason: 'wave-clear' });
    this.onWaveClear(summary);
  }

  dimensions() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const min = Math.min(width, height);
    return {
      width,
      height,
      min,
      playerSize: min * 0.145,
      enemySize: min * 0.105,
      playerBulletSize: min * 0.040,
      enemyBulletSize: min * 0.046
    };
  }

  normalizedBox(x, y, sizePx, scaleX = 0.58, scaleY = 0.58) {
    const { width, height } = this.dimensions();
    return {
      x,
      y,
      w: (sizePx * scaleX) / width,
      h: (sizePx * scaleY) / height
    };
  }

  updateCollisions() {
    const dim = this.dimensions();

    for (let i = this.playerBullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.playerBullets[i];
      const bulletBox = this.normalizedBox(bullet.x, bullet.y, dim.playerBulletSize, 0.32, 0.62);
      let hitEnemy = null;
      for (const enemy of this.enemies) {
        if (!enemy.alive || bullet.hitIds?.includes(enemy.id)) continue;
        if (Number(enemy.spawnAge || 0) < Number(enemy.spawnDuration || 0)) continue;
        const spec = ENEMY[enemy.type] || ENEMY.fighter;
        const enemyBox = this.normalizedBox(enemy.x, enemy.y, dim.enemySize * spec.size, spec.hitScaleX, spec.hitScaleY);
        if (intersects(bulletBox, enemyBox)) {
          hitEnemy = enemy;
          break;
        }
      }
      if (!hitEnemy) continue;

      bullet.hitIds ||= [];
      bullet.hitIds.push(hitEnemy.id);
      if (!bullet.countedHit) { this.stats.shotsHit += 1; bullet.countedHit = true; }
      this.damageEnemy(hitEnemy, bullet);
      if (Number(bullet.pierce || 0) > 0) bullet.pierce -= 1;
      else this.playerBullets.splice(i, 1);
    }

    if (this.player.respawnTimer > 0 || this.player.invulnerabilityTimer > 0 || this.player.lives <= 0) return;
    const playerBox = this.normalizedBox(this.player.x, this.player.y, dim.playerSize, 0.42, 0.50);

    for (let i = this.enemyBullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.enemyBullets[i];
      const bulletBox = this.normalizedBox(bullet.x, bullet.y, dim.enemyBulletSize * (bullet.charged ? 1.25 : 1), 0.30, 0.52);
      if (!intersects(playerBox, bulletBox)) continue;
      this.enemyBullets.splice(i, 1);
      this.damagePlayer();
      return;
    }

    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.mode === 'formation' || enemy.type === 'finalBoss') continue;
      const spec = ENEMY[enemy.type] || ENEMY.fighter;
      const enemyBox = this.normalizedBox(enemy.x, enemy.y, dim.enemySize * spec.size, spec.hitScaleX * 0.85, spec.hitScaleY * 0.85);
      if (!intersects(playerBox, enemyBox)) continue;
      this.damagePlayer();
      if (enemy.type === 'charger') this.effects.push({ x: enemy.x, y: enemy.y, age: 0, duration: 0.32, kind: 'chargeImpact' });
      this.returnToFormation(enemy);
      return;
    }
  }

  damageEnemy(enemy, impact = null) {
    if (!enemy?.alive) return;
    enemy.hp = Math.max(0, Number(enemy.hp || 1) - 1);
    // Fast white contact flash: strong enough to read, short enough to preserve bullet clarity.
    enemy.hitFlashTimer = 0.095;
    enemy.hpReadTimer = enemy.hp > 0 && Number(enemy.maxHp || 1) > 1 && !['miniBoss', 'finalBoss'].includes(enemy.type) ? 0.95 : 0;
    const palette = ENEMY_VFX[enemy.type] || ENEMY_VFX.fighter;
    const hitX = Number(impact?.x ?? enemy.x);
    const hitY = Number(impact?.y ?? enemy.y);
    this.effects.push({ x: hitX, y: hitY, age: 0, duration: 0.16, kind: 'hit', enemyType: enemy.type });
    if (this.safariPortrait) {
      if (enemy.hp <= 0) this.killEnemy(enemy);
      else {
        this.emitAudio('enemy-hit', { enemyType: enemy.type, hp: enemy.hp, maxHp: enemy.maxHp });
        this.emitHud();
      }
      return;
    }
    this.effects.push({ x: hitX, y: hitY, age: 0, duration: 0.19, kind: 'impactRing', color: palette.spark });

    // Directional sparks fan back from the incoming projectile instead of exploding radially.
    // This makes each hit communicate where the shot came from without changing combat state.
    const incomingVx = Number(impact?.vx || 0);
    const incomingVy = Number(impact?.vy || -1);
    const incomingMag = Math.hypot(incomingVx, incomingVy) || 1;
    const reverseAngle = Math.atan2(-incomingVy / incomingMag, -incomingVx / incomingMag);
    const sparkCount = this.safariPortrait ? 2 : (this.reducedMotion ? 4 : 7);
    for (let i = 0; i < sparkCount; i += 1) {
      const fan = (this.random() - 0.5) * 1.10;
      const angle = reverseAngle + fan;
      const speed = 0.08 + this.random() * 0.14;
      this.effects.push({
        x: hitX, y: hitY,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        age: 0, duration: 0.22 + this.random() * 0.12, kind: 'spark',
        color: i % 3 === 0 ? '#ffffff' : palette.spark,
        size: 0.72 + this.random() * 0.72, streak: true
      });
    }
    if (enemy.hp <= 0) this.killEnemy(enemy);
    else {
      this.emitAudio('enemy-hit', { enemyType: enemy.type, hp: enemy.hp, maxHp: enemy.maxHp });
      this.emitHud();
    }
  }

  killEnemy(enemy) {
    const dangerKill = this.isDangerKill(enemy);
    const spec = ENEMY[enemy.type] || ENEMY.fighter;
    const multiplier = this.currentCombo();
    const baseAward = Math.round((SCORE_VALUES[enemy.type] || spec.score || 0) * multiplier);
    const dangerBonus = dangerKill ? Math.round(baseAward * DANGER_KILL_BONUS_RATE) : 0;
    const award = baseAward + dangerBonus;
    enemy.alive = false;
    enemy.mode = 'dead';
    this.emitAudio('enemy-destroyed', { enemyType: enemy.type, dangerKill, x: enemy.x, y: enemy.y });
    this.score += award;
    this.stats.kills += 1;
    this.stats.killsByType[enemy.type] = (this.stats.killsByType[enemy.type] || 0) + 1;
    if (dangerKill) this.stats.dangerKillsByType[enemy.type] = (this.stats.dangerKillsByType[enemy.type] || 0) + 1;
    const previousCombo = this.currentCombo();
    this.comboIndex = Math.min(this.comboSteps.length - 1, this.comboIndex + 1);
    const nextCombo = this.currentCombo();
    this.comboTimer = this.comboWindow;
    this.addOverdriveEnergy(4);
    this.spawnEnemyDeathVfx(enemy);
    if (!this.safariPortrait) {
      this.effects.push({ x: enemy.x, y: enemy.y - 0.025, age: 0, duration: 0.72, kind: 'scoreText', text: `+${award.toLocaleString()}`, color: '#effcff' });
      if (dangerKill) this.effects.push({ x: enemy.x, y: enemy.y + 0.012, age: 0, duration: 0.68, kind: 'riskText', text: 'RISK +25%', color: '#ffbf79' });
      if (nextCombo > previousCombo) this.effects.push({ x: enemy.x, y: enemy.y + 0.035, age: 0, duration: 0.82, kind: 'comboText', text: `COMBO x${nextCombo}`, color: '#7ff2ff' });
    }
    if (dangerKill) this.emitVfx('danger-kill', { enemyType: enemy.type, baseAward, dangerBonus, multiplier });
    if (['heavy', 'charger', 'elite', 'miniBoss'].includes(enemy.type)) this.triggerShake(enemy.type === 'miniBoss' ? 0.72 : 0.24, enemy.type === 'miniBoss' ? 0.30 : 0.12);
    if (enemy.type === 'finalBoss') {
      this.cleanupFinalBossAdds(enemy.id);
      this.patternBanner = { label: 'BOSS DESTROYED +5,000', timer: 1.8 };
      this.triggerShake(1.35, 0.62);
      this.triggerVisualFreeze(0.11);
      this.emitVfx('boss-destroyed', { x: enemy.x, y: enemy.y });
    }
    this.emitHud();
  }

  spawnEnemyDeathVfx(enemy, { bomb = false } = {}) {
    const palette = ENEMY_VFX[enemy.type] || ENEMY_VFX.fighter;
    const boss = ['miniBoss', 'finalBoss'].includes(enemy.type);
    const heavy = ['heavy', 'elite', 'charger'].includes(enemy.type);

    if (bomb && this.mobilePortrait) {
      const pushBombFx = (effect) => {
        if (this.bombVfxEffectBudget <= 0) return false;
        this.effects.push(effect);
        this.bombVfxEffectBudget -= 1;
        return true;
      };
      const detailed = boss || this.bombVfxDetailedRemaining > 0;
      if (!boss && detailed) this.bombVfxDetailedRemaining -= 1;
      const duration = boss ? 0.58 : heavy ? 0.40 : 0.30;

      // Every bomb kill still gets a readable explosion. Only a few receive the
      // full layered treatment so a formation wipe cannot create 100+ effects.
      pushBombFx({ x: enemy.x, y: enemy.y, age: 0, duration, kind: 'explosion', enemyType: enemy.type, color: palette.burst, bomb: true });
      if (detailed) {
        pushBombFx({ x: enemy.x, y: enemy.y, age: 0, duration: 0.09, kind: 'coreFlash', enemyType: enemy.type, color: palette.spark, strength: boss ? 1.35 : 1 });
        pushBombFx({ x: enemy.x, y: enemy.y, age: 0, duration: duration * 0.72, kind: 'deathRing', enemyType: enemy.type, color: palette.burst, strength: boss ? 1.35 : 1 });
      }
      const fragments = boss ? 5 : detailed ? 2 : 1;
      for (let i = 0; i < fragments; i += 1) {
        const angle = this.random() * Math.PI * 2;
        const speed = 0.08 + this.random() * (boss ? 0.14 : 0.09);
        if (!pushBombFx({
          x: enemy.x, y: enemy.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          age: 0, duration: 0.26 + this.random() * 0.18, kind: 'debris',
          color: i % 2 ? palette.spark : palette.burst, size: 0.60 + this.random() * 0.85
        })) break;
      }
      return;
    }
    if (this.safariPortrait) {
      const duration = boss ? 0.52 : heavy ? 0.34 : 0.24;
      this.effects.push({ x: enemy.x, y: enemy.y, age: 0, duration, kind: 'explosion', enemyType: enemy.type, color: palette.burst, bomb });
      if (boss || heavy) this.effects.push({ x: enemy.x, y: enemy.y, age: 0, duration: duration * 0.68, kind: 'deathRing', enemyType: enemy.type, color: palette.burst, strength: boss ? 1.2 : 0.9 });
      return;
    }
    const duration = boss ? 0.78 : heavy ? 0.50 : 0.36;
    // VFX Patch 2 layered kill read: core flash -> sprite burst -> shockwave -> debris -> lingering energy haze.
    this.effects.push({ x: enemy.x, y: enemy.y, age: 0, duration: boss ? 0.15 : 0.10, kind: 'coreFlash', enemyType: enemy.type, color: palette.spark, strength: boss ? 1.75 : heavy ? 1.35 : 1 });
    this.effects.push({ x: enemy.x, y: enemy.y, age: boss ? -0.025 : -0.012, duration, kind: 'explosion', enemyType: enemy.type, color: palette.burst, bomb });
    this.effects.push({ x: enemy.x, y: enemy.y, age: 0, duration: duration * 0.82, kind: 'deathRing', enemyType: enemy.type, color: palette.burst, strength: boss ? 1.8 : heavy ? 1.35 : 1 });
    this.effects.push({ x: enemy.x, y: enemy.y, age: boss ? -0.12 : -0.07, duration: boss ? 0.86 : heavy ? 0.64 : 0.48, kind: 'energyCloud', enemyType: enemy.type, color: palette.burst, strength: boss ? 1.65 : heavy ? 1.25 : 1, seed: this.random() });
    const fragments = boss ? 14 : heavy ? 9 : 6;
    for (let i = 0; i < fragments; i += 1) {
      const angle = this.random() * Math.PI * 2;
      const speed = (boss ? 0.16 : 0.10) + this.random() * (boss ? 0.20 : 0.13);
      this.effects.push({
        x: enemy.x, y: enemy.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        age: 0, duration: 0.34 + this.random() * (boss ? 0.42 : 0.24), kind: 'debris',
        color: i % 2 ? palette.spark : palette.burst, size: 0.65 + this.random() * 1.3
      });
    }
    if (!boss && !heavy && !this.reducedMotion) {
      this.effects.push({ x: enemy.x + (this.random() - 0.5) * 0.018, y: enemy.y + (this.random() - 0.5) * 0.012, age: -0.055, duration: 0.34, kind: 'secondaryBurst', color: palette.burst });
    }
    if (enemy.type === 'finalBoss') {
      const offsets = [[-0.055,-0.015],[0.048,-0.025],[-0.022,0.035],[0.035,0.045],[0,-0.055],[0,0]];
      offsets.forEach(([ox, oy], index) => this.effects.push({ x: enemy.x + ox, y: enemy.y + oy, age: -index * 0.085, duration: 0.62, kind: 'secondaryBurst', color: index % 2 ? palette.spark : palette.burst }));
      this.effects.push({ x: enemy.x, y: enemy.y, age: -0.18, duration: 0.88, kind: 'eliteCross', color: '#ffe49a' });
    } else if (enemy.type === 'miniBoss') {
      this.effects.push({ x: enemy.x - 0.03, y: enemy.y, age: -0.06, duration: 0.52, kind: 'secondaryBurst', color: palette.burst });
      this.effects.push({ x: enemy.x + 0.03, y: enemy.y + 0.01, age: -0.14, duration: 0.52, kind: 'secondaryBurst', color: palette.spark });
    } else if (enemy.type === 'heavy') {
      this.effects.push({ x: enemy.x - 0.018, y: enemy.y, age: -0.07, duration: 0.42, kind: 'secondaryBurst', color: palette.burst });
      this.effects.push({ x: enemy.x + 0.018, y: enemy.y + 0.01, age: -0.13, duration: 0.42, kind: 'secondaryBurst', color: palette.spark });
    } else if (enemy.type === 'elite') {
      this.effects.push({ x: enemy.x, y: enemy.y, age: 0, duration: 0.55, kind: 'eliteCross', color: palette.burst });
    } else if (enemy.type === 'charger') {
      this.effects.push({ x: enemy.x, y: enemy.y, age: 0, duration: 0.42, kind: 'chargeImpact' });
    }
  }

  damagePlayer() {
    this.player.lives = Math.max(0, this.player.lives - 1);
    this.stats.damageTaken += 1;
    const lostCombo = this.currentCombo();
    if (lostCombo > 1) this.effects.push({ x: this.player.x, y: this.player.y - 0.08, age: 0, duration: 0.72, kind: 'comboText', text: 'COMBO LOST', color: '#ff9a86' });
    this.comboIndex = 0;
    this.comboTimer = 0;
    this.effects.push({ x: this.player.x, y: this.player.y, age: 0, duration: 0.35, kind: 'hit' });
    this.triggerShake(0.68, 0.26);
    this.triggerVisualFreeze(0.055);
    this.emitAudio('player-hit', { lives: this.player.lives, x: this.player.x, y: this.player.y });
    this.emitVfx('player-hit', { lives: this.player.lives, x: this.player.x, y: this.player.y });
    if (this.playerVfx) {
      this.playerVfx.hitTimer = 0.42;
      this.playerVfx.hitX = this.player.x;
      this.playerVfx.hitY = this.player.y;
      this.playerVfx.recoilTimer = 0;
      this.playerVfx.muzzleTimer = 0;
    }
    this.emitHud();

    if (this.player.lives <= 0) {
      this.player.respawnTimer = 0;
      this.enemyBullets = [];
      if (!this.runLostSent) {
        this.runLostSent = true;
        this.onRunLost(this.snapshot());
      }
      return;
    }

    this.player.respawnTimer = 1.5;
    this.player.invulnerabilityTimer = 0;
    this.enemyBullets = this.enemyBullets.filter((bullet) => bullet.y < 0.70);
  }

  updateEffects(dt) {
    let write = 0;
    for (let i = 0; i < this.effects.length; i += 1) {
      const effect = this.effects[i];
      effect.age += dt;
      if (Number.isFinite(effect.vx)) effect.x += effect.vx * dt;
      if (Number.isFinite(effect.vy)) effect.y += effect.vy * dt;
      if (effect.kind === 'debris') effect.vy += 0.10 * dt;
      if (this.safariPortrait) {
        if (effect.age < effect.duration) this.effects[write++] = effect;
      }
    }
    if (this.safariPortrait) {
      this.effects.length = write;
      if (this.effects.length > 24) this.effects.splice(0, this.effects.length - 24);
    } else {
      this.effects = this.effects.filter((effect) => effect.age < effect.duration);
    }
  }

  snapshot() {
    const accuracy = this.stats.shotsFired > 0
      ? Math.round((this.stats.shotsHit / this.stats.shotsFired) * 10000) / 100
      : 0;
    const pattern = this.patternDirector?.snapshot() || { lastPattern: '', patternActivations: {} };
    const miniBoss = this.enemies.find((enemy) => enemy.type === 'miniBoss');
    const finalBoss = this.enemies.find((enemy) => enemy.type === 'finalBoss');
    return {
      wave: this.currentWave,
      score: this.score,
      lives: this.player.lives,
      kills: this.stats.kills,
      killsByType: { ...this.stats.killsByType },
      bombKillsByType: { ...this.stats.bombKillsByType },
      dangerKillsByType: { ...this.stats.dangerKillsByType },
      shotsFired: this.stats.shotsFired,
      shotsHit: this.stats.shotsHit,
      damageTaken: this.stats.damageTaken,
      accuracy,
      comboIndex: this.comboIndex,
      comboMultiplier: this.currentCombo(),
      comboTimer: Math.round(this.comboTimer * 100) / 100,
      overdriveEnergy: Math.round(this.overdriveEnergy * 100) / 100,
      overdriveActiveRemaining: Math.round(this.overdriveTimer * 100) / 100,
      bombAvailable: this.bombAvailable,
      bombUsed: this.bombUsed,
      waveElapsed: Math.round(this.waveElapsed * 100) / 100,
      waveStart: { ...this.waveStart },
      enemiesRemaining: this.enemies.filter((enemy) => enemy.alive).length,
      lastStandActive: this.lastStandActive,
      recoveryTimer: Math.round(Number(this.recoveryTimer || 0) * 1000) / 1000,
      miniBossHp: miniBoss?.alive ? miniBoss.hp : 0,
      miniBossMaxHp: miniBoss?.maxHp || 0,
      miniBossPhase: miniBoss?.alive ? this.miniBossPhase(miniBoss) : 0,
      finalBossHp: finalBoss?.alive ? finalBoss.hp : 0,
      finalBossMaxHp: finalBoss?.maxHp || 0,
      finalBossPhase: finalBoss?.alive ? this.finalBossPhase(finalBoss) : 0,
      lastPattern: pattern.lastPattern,
      patternActivations: pattern.patternActivations
    };
  }

  emitHud(force = false) {
    if (this.safariPortrait && this.running && !force) {
      this.hudDirty = true;
      return;
    }
    this.flushHud();
  }

  flushHud() {
    this.hudDirty = false;
    this.hudFlushClock = 0;
    this.onHud(this.snapshot());
  }

  drawAmbientSpace(dim) {
    if (this.safariPortrait || !this.ambientParticles?.length) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = this.vfxComposite(this.mobilePortrait && this.adaptiveVfxLevel >= 2 ? 'source-over' : 'lighter');
    const particleLimit = this.mobilePortrait
      ? Math.min(this.ambientParticles.length, this.adaptiveVfxLevel >= 2 ? 14 : this.adaptiveVfxLevel === 1 ? 20 : 28)
      : this.ambientParticles.length;
    for (let particleIndex = 0; particleIndex < particleLimit; particleIndex += 1) {
      const particle = this.ambientParticles[particleIndex];
      const depth = 0.65 + particle.layer * 0.25;
      const yNorm = (particle.y + this.elapsed * particle.speed * depth) % 1;
      const xNorm = (particle.x + Math.sin(this.elapsed * (0.18 + particle.layer * 0.06) + particle.y * 9) * particle.drift + 1) % 1;
      const x = xNorm * dim.width;
      const y = yNorm * dim.height;
      const radius = Math.max(0.6, dim.min * 0.0017 * particle.size * depth);
      const twinkle = this.reducedMotion ? 1 : 0.72 + Math.sin(this.elapsed * (1.8 + particle.layer) + particle.x * 17) * 0.28;
      ctx.globalAlpha = particle.alpha * twinkle;
      ctx.fillStyle = particle.layer === 2 ? '#bdefff' : '#74cfff';
      ctx.shadowBlur = this.vfxGlow(particle.layer === 2 ? 8 : 4);
      ctx.shadowColor = '#57cfff';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawOverdriveBurst(dim) {
    if (this.overdriveBurstTimer <= 0 || this.player.lives <= 0) return;
    const progress = 1 - clamp(this.overdriveBurstTimer / 0.95, 0, 1);
    const alpha = (1 - progress) * 0.9;
    const x = this.player.x * dim.width;
    const y = this.player.y * dim.height;
    const radius = dim.min * (0.08 + progress * 0.30);
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite(this.mobilePortrait ? 'source-over' : 'lighter');
    this.ctx.globalAlpha = alpha * (this.mobilePortrait ? 0.78 : 1);
    this.ctx.strokeStyle = '#91f7ff';
    this.ctx.lineWidth = Math.max(2, dim.min * 0.006 * (1 - progress * 0.65));
    this.ctx.shadowBlur = this.vfxGlow(this.mobilePortrait ? 10 : 24);
    this.ctx.shadowColor = '#5ee6ff';
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.globalAlpha = alpha * 0.42;
    this.ctx.strokeStyle = '#fff4ba';
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 0.72, -0.7, 2.15);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawBossPhaseBackdrop(dim) {
    if (this.bossPhaseBurstTimer <= 0) return;
    const boss = this.finalBoss() || this.miniBoss();
    if (!boss) return;
    const duration = boss.type === 'finalBoss' ? 0.90 : 0.82;
    const life = clamp(this.bossPhaseBurstTimer / duration, 0, 1);
    const x = boss.x * dim.width;
    const y = boss.y * dim.height;
    this.ctx.save();
    if (this.safariPortrait) {
      this.ctx.globalAlpha = life * (boss.type === 'finalBoss' ? 0.18 : 0.12);
      this.ctx.fillStyle = boss.type === 'finalBoss' ? '#4a1008' : '#382006';
      this.ctx.fillRect(0, 0, dim.width, dim.height);
      this.ctx.restore();
      return;
    }
    // A brief cinematic dim makes the phase change read without hiding bullets.
    this.ctx.globalAlpha = life * (boss.type === 'finalBoss' ? 0.24 : 0.17);
    this.ctx.fillStyle = '#02040c';
    this.ctx.fillRect(0, 0, dim.width, dim.height);
    const radius = dim.min * 0.48;
    const glow = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, boss.type === 'finalBoss' ? 'rgba(255,102,50,.30)' : 'rgba(255,169,80,.23)');
    glow.addColorStop(0.36, boss.type === 'finalBoss' ? 'rgba(255,60,35,.10)' : 'rgba(255,133,50,.07)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
    this.ctx.globalAlpha = life * 0.95;
    this.ctx.fillStyle = glow;
    this.ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    this.ctx.restore();
  }

  drawBossPhaseBurst(dim) {
    if (this.bossPhaseBurstTimer <= 0) return;
    const boss = this.finalBoss() || this.miniBoss();
    if (!boss) return;
    const duration = boss.type === 'finalBoss' ? 0.90 : 0.82;
    const progress = 1 - clamp(this.bossPhaseBurstTimer / duration, 0, 1);
    const alpha = (1 - progress) * (boss.type === 'finalBoss' ? 0.72 : 0.62);
    const x = boss.x * dim.width;
    const y = boss.y * dim.height;
    const primary = boss.type === 'finalBoss' ? '#ffb16f' : '#ffd18a';
    const glow = boss.type === 'finalBoss' ? '#ff6438' : '#ff9b4f';
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
    this.ctx.globalAlpha = alpha;
    this.ctx.strokeStyle = primary;
    this.ctx.lineWidth = Math.max(2, dim.min * 0.007 * (1 - progress * 0.7));
    this.ctx.shadowBlur = this.vfxGlow(28);
    this.ctx.shadowColor = glow;
    for (let i = 0; i < 3; i += 1) {
      this.ctx.beginPath();
      this.ctx.arc(x, y, dim.min * (0.055 + progress * (0.19 + i * 0.055)), 0, Math.PI * 2);
      this.ctx.stroke();
    }
    // Cross-shaped energy lances sell a clear phase transition moment.
    const lance = dim.min * (0.07 + progress * 0.20);
    this.ctx.globalAlpha = alpha * 0.58;
    this.ctx.lineWidth = Math.max(1, dim.min * 0.0035 * (1 - progress * 0.4));
    for (let i = 0; i < 4; i += 1) {
      const a = Math.PI * 0.25 + i * Math.PI * 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(x + Math.cos(a) * lance * 0.28, y + Math.sin(a) * lance * 0.28);
      this.ctx.lineTo(x + Math.cos(a) * lance, y + Math.sin(a) * lance);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawWaveStartSweep(dim) {
    if (this.safariPortrait || this.waveStartFxTimer <= 0) return;
    const progress = 1 - clamp(this.waveStartFxTimer / 1.25, 0, 1);
    const fade = Math.sin(clamp(progress, 0, 1) * Math.PI);
    const y = dim.height * (0.14 + progress * 0.72);
    const final = this.currentWave === 10;
    const accent = final ? '255,105,62' : '91,229,255';
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
    const band = this.ctx.createLinearGradient(0, y - dim.min * 0.06, 0, y + dim.min * 0.06);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(0.5, `rgba(${accent},${0.10 * fade})`);
    band.addColorStop(1, 'rgba(0,0,0,0)');
    this.ctx.fillStyle = band;
    this.ctx.fillRect(0, y - dim.min * 0.06, dim.width, dim.min * 0.12);
    this.ctx.globalAlpha = fade * 0.84;
    this.ctx.strokeStyle = final ? '#ff8d64' : '#9df5ff';
    this.ctx.lineWidth = Math.max(1, dim.min * 0.0022);
    this.ctx.shadowBlur = this.vfxGlow(18);
    this.ctx.shadowColor = final ? '#ff5e3c' : '#5be8ff';
    this.ctx.beginPath();
    this.ctx.moveTo(0, y);
    this.ctx.lineTo(dim.width, y);
    this.ctx.stroke();
    this.ctx.globalAlpha = fade * 0.30;
    this.ctx.beginPath();
    this.ctx.moveTo(dim.width * 0.18, y - dim.min * 0.018);
    this.ctx.lineTo(dim.width * 0.82, y - dim.min * 0.018);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawOverdriveField(dim) {
    if (this.safariPortrait) return;
    if (this.overdriveTimer <= 0 || this.player.lives <= 0) return;
    const remaining = clamp(this.overdriveTimer / 7, 0, 1);
    const entrance = clamp((7 - this.overdriveTimer) / 0.35, 0, 1);
    const intensity = Math.min(1, entrance + (1 - remaining) * 0.12);
    this.ctx.save();
    // Keep the field at the edges so enemy bullets stay readable. On portrait
    // mobile avoid allocating a full-canvas radial gradient every frame.
    if (this.mobilePortrait) {
      this.ctx.globalAlpha = 0.035 * intensity;
      this.ctx.fillStyle = '#48dcff';
      this.ctx.fillRect(0, 0, dim.width, dim.height);
      this.ctx.globalAlpha = 1;
    } else {
      const vignette = this.ctx.createRadialGradient(dim.width * 0.5, dim.height * 0.55, dim.min * 0.18, dim.width * 0.5, dim.height * 0.55, dim.min * 0.78);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(0.72, 'rgba(35,184,255,.015)');
      vignette.addColorStop(1, `rgba(64,220,255,${0.075 * intensity})`);
      this.ctx.fillStyle = vignette;
      this.ctx.fillRect(0, 0, dim.width, dim.height);
    }
    if (!this.reducedMotion) {
      this.ctx.globalCompositeOperation = this.vfxComposite(this.mobilePortrait ? 'source-over' : 'lighter');
      this.ctx.lineCap = 'round';
      const overdriveLaneCount = this.mobilePortrait ? 6 : 12;
      for (let i = 0; i < overdriveLaneCount; i += 1) {
        const lane = (i + 0.5) / overdriveLaneCount;
        const phase = (this.elapsed * (0.72 + (i % 3) * 0.11) + i * 0.137) % 1;
        const y = dim.height * (1.08 - phase * 1.18);
        const x = dim.width * lane + Math.sin(i * 2.7) * dim.min * 0.018;
        const len = dim.min * (0.055 + (i % 4) * 0.012);
        this.ctx.globalAlpha = 0.10 + (i % 3) * 0.025;
        this.ctx.strokeStyle = i % 4 === 0 ? '#fff2aa' : '#73edff';
        this.ctx.lineWidth = Math.max(1, dim.min * 0.0018);
        this.ctx.shadowBlur = this.vfxGlow(this.mobilePortrait ? 5 : 10);
        this.ctx.shadowColor = '#5ee8ff';
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x, y + len);
        this.ctx.stroke();
      }
    }
    this.ctx.restore();
  }

  drawBossLaserTelegraphFx(dim) {
    if (!this.bossLaser) return;
    const x = this.bossLaser.x * dim.width;
    const laneHalf = this.bossLaser.width * dim.width;
    const top = dim.height * 0.08;
    const bottom = dim.height * 0.94;
    if (this.safariPortrait) {
      this.ctx.save();
      if (this.bossLaser.telegraph > 0) {
        const duration = Math.max(0.01, Number(this.bossLaser.telegraphDuration || this.bossLaser.telegraph));
        const progress = 1 - clamp(this.bossLaser.telegraph / duration, 0, 1);
        this.ctx.globalAlpha = 0.12 + progress * 0.12;
        this.ctx.fillStyle = '#ff5c45';
        this.ctx.fillRect(x - laneHalf, top, laneHalf * 2, bottom - top);
        this.ctx.globalAlpha = 0.78;
        this.ctx.strokeStyle = '#ffb08d';
        this.ctx.lineWidth = Math.max(1.5, dim.min * 0.0028);
        this.ctx.beginPath();
        this.ctx.moveTo(x - laneHalf, top); this.ctx.lineTo(x - laneHalf, bottom);
        this.ctx.moveTo(x + laneHalf, top); this.ctx.lineTo(x + laneHalf, bottom);
        this.ctx.stroke();
      }
      if (this.bossLaserFireFlashTimer > 0) {
        const life = clamp(this.bossLaserFireFlashTimer / 0.22, 0, 1);
        this.ctx.globalAlpha = life * 0.34;
        this.ctx.fillStyle = '#fff0df';
        this.ctx.fillRect(x - laneHalf * 1.35, top, laneHalf * 2.7, bottom - top);
      }
      this.ctx.restore();
      return;
    }
    if (this.bossLaser.telegraph > 0) {
      const duration = Math.max(0.01, Number(this.bossLaser.telegraphDuration || this.bossLaser.telegraph));
      const progress = 1 - clamp(this.bossLaser.telegraph / duration, 0, 1);
      const pulse = this.reducedMotion ? 0.72 : 0.58 + Math.sin(this.elapsed * (16 + progress * 10)) * 0.20;
      this.ctx.save();
      const lane = this.ctx.createLinearGradient(x - laneHalf * 1.6, 0, x + laneHalf * 1.6, 0);
      lane.addColorStop(0, 'rgba(255,50,50,0)');
      lane.addColorStop(0.35, `rgba(255,70,54,${0.07 + progress * 0.08})`);
      lane.addColorStop(0.5, `rgba(255,188,118,${0.10 + progress * 0.10})`);
      lane.addColorStop(0.65, `rgba(255,70,54,${0.07 + progress * 0.08})`);
      lane.addColorStop(1, 'rgba(255,50,50,0)');
      this.ctx.fillStyle = lane;
      this.ctx.fillRect(x - laneHalf * 2.1, top, laneHalf * 4.2, bottom - top);
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = pulse;
      this.ctx.strokeStyle = '#ff8f72';
      this.ctx.lineWidth = Math.max(1.5, dim.min * 0.0028);
      this.ctx.setLineDash([Math.max(7, dim.min * 0.018), Math.max(5, dim.min * 0.012)]);
      this.ctx.lineDashOffset = this.reducedMotion ? 0 : -this.elapsed * dim.min * 0.18;
      this.ctx.shadowBlur = this.vfxGlow(15);
      this.ctx.shadowColor = '#ff593d';
      for (const edge of [-1, 1]) {
        this.ctx.beginPath();
        this.ctx.moveTo(x + edge * laneHalf, top);
        this.ctx.lineTo(x + edge * laneHalf, bottom);
        this.ctx.stroke();
      }
      this.ctx.setLineDash([]);
      // Charge core at the top of the threatened lane.
      const coreR = dim.min * (0.012 + progress * 0.018);
      const core = this.ctx.createRadialGradient(x, top, 0, x, top, coreR);
      core.addColorStop(0, '#ffffff');
      core.addColorStop(0.28, '#ffd2a9');
      core.addColorStop(1, 'rgba(255,70,40,0)');
      this.ctx.globalAlpha = 0.74 + progress * 0.22;
      this.ctx.fillStyle = core;
      this.ctx.beginPath(); this.ctx.arc(x, top, coreR, 0, Math.PI * 2); this.ctx.fill();
      this.ctx.restore();
    }
    if (this.bossLaserFireFlashTimer > 0) {
      const life = clamp(this.bossLaserFireFlashTimer / 0.22, 0, 1);
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = life * 0.52;
      const flash = this.ctx.createLinearGradient(x - laneHalf * 2.2, 0, x + laneHalf * 2.2, 0);
      flash.addColorStop(0, 'rgba(255,120,80,0)');
      flash.addColorStop(0.5, 'rgba(255,248,225,.95)');
      flash.addColorStop(1, 'rgba(255,120,80,0)');
      this.ctx.fillStyle = flash;
      this.ctx.fillRect(x - laneHalf * 2.2, top, laneHalf * 4.4, bottom - top);
      this.ctx.restore();
    }
  }

  drawBombPowerMoment(dim) {
    if (this.bombFlashTimer <= 0) return;
    const progress = 1 - clamp(this.bombFlashTimer / 0.82, 0, 1);
    const life = 1 - progress;
    const bx = this.player.x * dim.width;
    const by = this.player.y * dim.height;
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite(this.mobilePortrait ? 'source-over' : 'lighter');
    // A very short white core, then cyan rays; all presentation-only.
    const whiteCore = clamp((life - 0.72) / 0.28, 0, 1);
    if (whiteCore > 0) {
      this.ctx.globalAlpha = whiteCore * (this.mobilePortrait ? 0.28 : 0.42);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, dim.width, dim.height);
    }
    this.ctx.strokeStyle = '#c7fbff';
    this.ctx.shadowBlur = this.vfxGlow(this.mobilePortrait ? 8 : 20);
    this.ctx.shadowColor = '#5de6ff';
    this.ctx.lineCap = 'round';
    const rayAlpha = Math.sin(progress * Math.PI) * (this.mobilePortrait ? 0.26 : 0.34);
    const inner = dim.min * (0.08 + progress * 0.10);
    const outer = dim.min * (0.38 + progress * 0.54);
    const bombRayCount = this.mobilePortrait ? 6 : 12;
    for (let i = 0; i < bombRayCount; i += 1) {
      const angle = i * Math.PI * 2 / bombRayCount + 0.12;
      this.ctx.globalAlpha = rayAlpha * (i % 3 === 0 ? 1 : 0.62);
      this.ctx.lineWidth = Math.max(1, dim.min * (i % 3 === 0 ? 0.0032 : 0.0018));
      this.ctx.beginPath();
      this.ctx.moveTo(bx + Math.cos(angle) * inner, by + Math.sin(angle) * inner);
      this.ctx.lineTo(bx + Math.cos(angle) * outer, by + Math.sin(angle) * outer);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawVisualFreeze(dim) {
    if (this.visualFreezeTimer <= 0) return;
    const alpha = clamp(this.visualFreezeTimer / 0.12, 0, 1) * 0.16;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, dim.width, dim.height);
    this.ctx.restore();
  }

  draw() {
    const { ctx } = this;
    const dim = this.dimensions();
    ctx.clearRect(0, 0, dim.width, dim.height);
    ctx.save();
    if (this.visualShake.timer > 0 && this.visualShake.strength > 0 && !this.reducedMotion) {
      const falloff = clamp(this.visualShake.timer / Math.max(0.001, this.visualShake.duration), 0, 1);
      const amplitude = dim.min * 0.0105 * this.visualShake.strength * falloff;
      const shakeX = Math.sin(this.elapsed * 119) * amplitude;
      const shakeY = Math.cos(this.elapsed * 143 + 0.8) * amplitude * 0.72;
      ctx.translate(shakeX, shakeY);
    }
    this.drawAmbientSpace(dim);
    this.drawBossPhaseBackdrop(dim);
    this.drawWaveStartSweep(dim);
    this.drawOverdriveField(dim);

    if (this.bombFlashTimer > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(this.bombFlashTimer / 0.82, 0, 1) * (this.mobilePortrait ? 0.18 : 0.28);
      ctx.fillStyle = '#dff9ff';
      ctx.fillRect(0, 0, dim.width, dim.height);
      ctx.restore();
      const bombProgress = 1 - clamp(this.bombFlashTimer / 0.82, 0, 1);
      const bx = this.player.x * dim.width;
      const by = this.player.y * dim.height;
      ctx.save();
      ctx.globalCompositeOperation = this.vfxComposite(this.mobilePortrait ? 'source-over' : 'lighter');
      ctx.globalAlpha = (1 - bombProgress) * (this.mobilePortrait ? 0.60 : 0.82);
      ctx.strokeStyle = '#dffcff';
      ctx.shadowBlur = this.vfxGlow(this.mobilePortrait ? 10 : 30);
      ctx.shadowColor = '#69e7ff';
      const bombRingCount = this.mobilePortrait ? 2 : 3;
      for (let ring = 0; ring < bombRingCount; ring += 1) {
        ctx.lineWidth = Math.max(2, dim.min * (0.007 - ring * 0.0015));
        ctx.beginPath();
        ctx.arc(bx, by, dim.min * (0.08 + bombProgress * (0.72 + ring * 0.10)), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      this.drawBombPowerMoment(dim);
    }

    if (this.bossLaser) {
      const image = this.bossLaser.telegraph > 0 ? this.images.finalBossLaserTelegraph : this.images.finalBossLaserBeam;
      const alpha = this.bossLaser.telegraph > 0 ? 0.55 + Math.sin(this.elapsed * 20) * 0.25 : 0.95;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0.2, 1);
      if (canDraw(image)) {
        const width = dim.min * (this.bossLaser.telegraph > 0 ? 0.11 : 0.14);
        const x = this.bossLaser.x * dim.width;
        ctx.drawImage(image, x - width / 2, dim.height * 0.08, width, dim.height * 0.86);
      } else {
        ctx.fillStyle = this.bossLaser.telegraph > 0 ? 'rgba(255,120,120,.35)' : 'rgba(255,238,220,.82)';
        ctx.fillRect((this.bossLaser.x - this.bossLaser.width) * dim.width, dim.height * 0.08, this.bossLaser.width * 2 * dim.width, dim.height * 0.86);
      }
      ctx.restore();
      this.drawBossLaserTelegraphFx(dim);
    }

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      this.drawEnemyActor(enemy, dim);
    }

    const boss = this.enemies.find((enemy) => enemy.alive && ['miniBoss', 'finalBoss'].includes(enemy.type));
    if (boss) this.drawBossHealth(boss, dim);

    for (const bullet of this.playerBullets) this.drawPlayerProjectile(bullet, dim);

    for (const effect of this.effects) if (UNDER_BULLET_EFFECTS.has(effect.kind)) this.drawCombatEffect(effect, dim);
    for (const bullet of this.enemyBullets) this.drawEnemyProjectile(bullet, dim);
    for (const effect of this.effects) if (!UNDER_BULLET_EFFECTS.has(effect.kind)) this.drawCombatEffect(effect, dim);

    this.drawBossPhaseBurst(dim);
    this.drawThrusterParticles(dim);
    this.drawOverdriveBurst(dim);

    if (this.player.respawnTimer <= 0 && this.player.lives > 0) {
      const recoilPhase = this.playerVfx?.recoilTimer > 0 ? clamp(this.playerVfx.recoilTimer / 0.11, 0, 1) : 0;
      const recoilPx = this.reducedMotion ? 0 : Math.sin(recoilPhase * Math.PI) * dim.playerSize * 0.055;
      const visualY = this.player.y + recoilPx / Math.max(1, dim.height);
      this.drawPlayerMotionTrail(dim, visualY);
      this.drawPlayerThruster(dim, visualY);
      if (this.overdriveTimer > 0) {
        const pulse = 1 + Math.sin(this.elapsed * 15) * 0.06;
        ctx.save(); ctx.globalAlpha = 0.48 + Math.sin(this.elapsed * 12) * 0.12; this.drawSprite(this.images.overdrive, this.player.x, visualY, dim.playerSize * 1.6 * pulse, this.playerVfx?.tilt || 0); ctx.restore();
      }
      if (this.player.invulnerabilityTimer > 0) {
        const pulse = 1 + Math.sin(this.elapsed * 12) * 0.05;
        ctx.save(); ctx.globalAlpha = 0.62 + Math.sin(this.elapsed * 9) * 0.16; this.drawSprite(this.images.shield, this.player.x, visualY, dim.playerSize * 1.45 * pulse, this.playerVfx?.tilt || 0); ctx.restore();
      }
      this.drawSprite(this.images.player, this.player.x, visualY, dim.playerSize, this.playerVfx?.tilt || 0);
      if (this.playerVfx?.muzzleTimer > 0) this.drawMuzzleFlash(dim, visualY);
    }

    if (this.playerVfx?.hitTimer > 0) this.drawPlayerHitFeedback(dim);
    if (this.patternBanner.timer > 0) this.drawPatternBanner(this.patternBanner.label, dim);
    this.drawVisualFreeze(dim);
    ctx.restore();
  }

  enemyImage(enemy) {
    if (enemy.type === 'miniBoss') return this.images.miniBoss;
    if (enemy.type === 'finalBoss') return this.images.finalBoss;
    return this.images[enemy.type] || this.images.fighter;
  }

  enemyVisualState(enemy, dim) {
    const spec = ENEMY[enemy.type] || ENEMY.fighter;
    const spawnDuration = Math.max(0.01, Number(enemy.spawnDuration || 0.62));
    const spawnT = clamp(Number(enemy.spawnAge || 0) / spawnDuration, 0, 1);
    const spawnEase = easeOutCubic(spawnT);
    const boss = ['miniBoss', 'finalBoss'].includes(enemy.type);
    const direction = enemy.slotIndex % 2 === 0 ? -1 : 1;
    const startX = clamp(enemy.baseX + direction * (boss ? 0.14 : 0.10), 0.06, 0.94);
    const startY = boss ? -0.10 : -0.16 - (enemy.slotIndex % 3) * 0.025;
    const x = spawnT < 1 ? lerp(startX, enemy.x, spawnEase) + Math.sin(spawnT * Math.PI) * 0.045 * direction : enemy.x;
    const y = spawnT < 1 ? lerp(startY, enemy.y, spawnEase) : enemy.y;
    const idlePulse = this.reducedMotion ? 1 : 1 + Math.sin(this.elapsed * (enemy.type === 'heavy' ? 3.2 : 4.4) + Number(enemy.idleSeed || 0)) * (boss ? 0.018 : 0.026);
    const settle = spawnT < 1 ? 0.76 + spawnEase * 0.24 + Math.sin(spawnT * Math.PI) * 0.08 : 1;
    const alpha = spawnT < 0.05 ? 0 : clamp(spawnT * 1.8, 0, 1);
    const idleRoll = enemy.mode === 'formation' && !this.reducedMotion && !this.safariPortrait
      ? Math.sin(this.elapsed * 1.7 + Number(enemy.idleSeed || 0)) * (enemy.type === 'heavy' ? 0.018 : 0.035)
      : 0;
    return { x, y, size: dim.enemySize * spec.size * idlePulse * settle, alpha, rotation: Number(enemy.rotation ?? Math.PI) + idleRoll, spawnT };
  }

  drawEnemyActor(enemy, dim) {
    const state = this.enemyVisualState(enemy, dim);
    if (state.alpha <= 0) return;
    const image = this.enemyImage(enemy);
    const palette = ENEMY_VFX[enemy.type] || ENEMY_VFX.fighter;
    const attacking = enemy.mode !== 'formation' && Number(enemy.attackTime || 0) >= 0;

    if (enemy.type === 'miniBoss' && Number(enemy.bossPhase || 1) >= 2 && canDraw(this.images.miniBossPhaseAura)) {
      const auraPulse = this.reducedMotion ? 1 : 1 + Math.sin(this.elapsed * 5.5) * 0.06;
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = state.alpha * 0.52;
      this.ctx.shadowBlur = this.vfxGlow(26);
      this.ctx.shadowColor = '#ff8c57';
      this.drawSprite(this.images.miniBossPhaseAura, state.x, state.y, state.size * 1.26 * auraPulse, state.rotation * 0.18);
      this.ctx.restore();
    }

    if (enemy.type === 'finalBoss' && Number(enemy.bossPhase || 1) >= 2) {
      const phase = Number(enemy.bossPhase || 1);
      const auraPulse = this.reducedMotion ? 1 : 1 + Math.sin(this.elapsed * (phase === 3 ? 7.2 : 5.2)) * 0.06;
      const auraColor = phase === 3 ? '#ff5f88' : '#ff9566';
      const x = state.x * dim.width;
      const y = state.y * dim.height;
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = state.alpha * (phase === 3 ? 0.26 : 0.18);
      this.ctx.strokeStyle = auraColor;
      this.ctx.lineWidth = Math.max(2, dim.min * 0.006);
      this.ctx.shadowBlur = this.vfxGlow(phase === 3 ? 24 : 18);
      this.ctx.shadowColor = auraColor;
      this.ctx.beginPath();
      this.ctx.ellipse(x, y, state.size * 0.46 * auraPulse, state.size * 0.24 * auraPulse, 0, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.arc(x, y, state.size * (phase === 3 ? 0.34 : 0.28) * auraPulse, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    }

    // Motion after-images make dives/charges readable without adding new art assets.
    const allowMotionAfterImages = !this.safariPortrait && (!this.mobilePortrait || this.adaptiveVfxLevel < 2 || enemy.type === 'charger');
    if (attacking && enemy.trailPoints?.length && allowMotionAfterImages) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      enemy.trailPoints.forEach((point, index) => {
        const life = clamp(1 - Number(point.age || 0) / 0.32, 0, 1);
        this.ctx.globalAlpha = life * (enemy.type === 'charger' ? 0.22 : 0.14) * (1 - index * 0.06);
        this.ctx.shadowBlur = this.vfxGlow(12);
        this.ctx.shadowColor = palette.glow;
        this.drawSprite(image, point.x, point.y, state.size * (0.96 - index * 0.025), point.rotation ?? state.rotation);
      });
      this.ctx.restore();
    }

    if (!this.safariPortrait && enemy.type === 'diver' && attacking && canDraw(this.images.diveTrail)) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = 0.36 + Math.sin(this.elapsed * 20) * 0.08;
      this.drawSprite(this.images.diveTrail, state.x, state.y - 0.045, dim.enemySize * 1.42, state.rotation);
      this.ctx.restore();
    }
    if (!this.safariPortrait && enemy.type === 'charger' && attacking && canDraw(this.images.chargeTrail)) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = 0.50 + Math.sin(this.elapsed * 24) * 0.10;
      this.drawSprite(this.images.chargeTrail, state.x, state.y - 0.045, dim.enemySize * 1.58, state.rotation);
      this.ctx.restore();
    }

    // Subtle engine/core glow keeps formation enemies visually alive. Safari
    // portrait skips this per-enemy/per-frame gradient allocation.
    const px = state.x * dim.width;
    const py = state.y * dim.height;
    if (!this.safariPortrait) {
      const glowRadius = state.size * (enemy.type === 'elite' ? 0.42 : 0.32);
      const glow = this.ctx.createRadialGradient(px, py, 0, px, py, glowRadius);
      glow.addColorStop(0, palette.glow + '88');
      glow.addColorStop(1, palette.glow + '00');
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = state.alpha * (enemy.mode === 'formation' ? 0.34 : 0.48);
      this.ctx.fillStyle = glow;
      this.ctx.beginPath();
      this.ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }

    if (state.spawnT < 1) this.drawEnemySpawnStreak(enemy, state, dim, palette);
    if (enemy.attackTime < 0 && enemy.mode !== 'formation') this.drawAttackTelegraph(enemy, state, dim, palette);
    if (enemy.pendingShot) this.drawShooterCharge(enemy, state, dim, palette);

    this.ctx.save();
    this.ctx.globalAlpha = state.alpha;
    this.ctx.shadowBlur = this.vfxGlow(enemy.hitFlashTimer > 0 ? 24 : (enemy.type === 'elite' ? 13 : 8));
    this.ctx.shadowColor = enemy.hitFlashTimer > 0 ? '#ffffff' : palette.glow;
    if (enemy.hitFlashTimer > 0) this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
    this.drawSprite(image, state.x, state.y, state.size * (enemy.hitFlashTimer > 0 ? 1.035 : 1), state.rotation);
    this.ctx.restore();

    if (enemy.hitFlashTimer > 0) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = clamp(enemy.hitFlashTimer / 0.095, 0, 1) * 0.82;
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(px, py, state.size * 0.20, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
    if (Number(enemy.hpReadTimer || 0) > 0) this.drawEnemyHealthPips(enemy, state, dim, palette);
  }

  drawEnemyHealthPips(enemy, state, dim, palette) {
    const maxHp = Math.max(1, Math.floor(Number(enemy.maxHp || 1)));
    if (maxHp <= 1 || ['miniBoss', 'finalBoss'].includes(enemy.type)) return;
    const hp = Math.max(0, Math.min(maxHp, Math.floor(Number(enemy.hp || 0))));
    const shownSegments = Math.min(maxHp, 6);
    const filledSegments = Math.round((hp / maxHp) * shownSegments);
    const gap = Math.max(1, dim.min * 0.0018);
    const segmentW = Math.max(3, dim.min * 0.010);
    const segmentH = Math.max(2, dim.min * 0.0035);
    const width = shownSegments * segmentW + (shownSegments - 1) * gap;
    const x = state.x * dim.width - width / 2;
    const y = state.y * dim.height + state.size * 0.40;
    const alpha = clamp(Number(enemy.hpReadTimer || 0) / 0.35, 0, 1);
    this.ctx.save();
    this.ctx.globalAlpha = 0.90 * alpha;
    this.ctx.shadowBlur = this.vfxGlow(7);
    this.ctx.shadowColor = palette.glow;
    for (let i = 0; i < shownSegments; i += 1) {
      this.ctx.fillStyle = i < filledSegments ? palette.spark : 'rgba(18,34,52,.72)';
      this.ctx.fillRect(x + i * (segmentW + gap), y, segmentW, segmentH);
    }
    this.ctx.restore();
  }

  drawEnemySpawnStreak(enemy, state, dim, palette) {
    if (this.safariPortrait) return;
    const t = state.spawnT;
    const x = state.x * dim.width;
    const y = state.y * dim.height;
    const length = dim.min * (0.12 + (1 - t) * 0.12);
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
    this.ctx.globalAlpha = (1 - t) * 0.72;
    const gradient = this.ctx.createLinearGradient(x, y - length, x, y + length * 0.15);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.72, palette.glow + '99');
    gradient.addColorStop(1, '#ffffffcc');
    this.ctx.strokeStyle = gradient;
    this.ctx.lineWidth = Math.max(1.5, dim.min * 0.006);
    this.ctx.shadowBlur = this.vfxGlow(16);
    this.ctx.shadowColor = palette.glow;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y - length);
    this.ctx.lineTo(x, y + length * 0.08);
    this.ctx.stroke();
    this.ctx.restore();
  }

  attackPreviewPoint(attack, t) {
    const startX = Number(attack?.startX ?? 0.5);
    const startY = Number(attack?.startY ?? 0.2);
    const side = Number(attack?.side || 1);
    const kind = String(attack?.kind || '');
    if (kind === 'dive') return diveRoutePoint(attack, t);
    if (kind === 'charge') {
      const targetX = Number(attack?.targetX ?? this.player.x);
      const dive = Math.sin(t * Math.PI);
      let x = lerp(startX, targetX, Math.min(1, t * 1.35));
      const y = startY + dive * 0.69;
      if (t > 0.72) x = lerp(x, startX, (t - 0.72) / 0.28);
      return { x: clamp(x, 0.04, 0.96), y };
    }
    if (kind === 'pincer') {
      const targetX = side < 0 ? 0.68 : 0.32;
      const enter = Math.min(1, t * 1.7);
      const leave = Math.max(0, (t - 0.62) / 0.38);
      let x = lerp(startX, targetX, enter) + Math.sin(t * Math.PI * 2) * 0.035 * side;
      const y = startY + Math.sin(t * Math.PI) * 0.60;
      if (leave > 0) x = lerp(x, startX, leave);
      return { x: clamp(x, 0.04, 0.96), y };
    }
    if (kind === 'spiral') {
      const angle = t * Math.PI * 5 + Number(attack?.phaseOffset || 0);
      const radius = 0.08 + Math.sin(t * Math.PI) * 0.18;
      return { x: clamp(0.5 + Math.cos(angle) * radius, 0.04, 0.96), y: startY + t * 0.53 + Math.sin(angle) * 0.09 };
    }
    if (kind === 'eliteAssault') {
      return { x: clamp(startX + Math.sin(t * Math.PI * 4) * 0.19 * side, 0.05, 0.95), y: startY + Math.sin(t * Math.PI) * 0.44 };
    }
    return null;
  }

  drawAttackRouteTelegraph(enemy, state, dim, palette, remaining) {
    if (this.safariPortrait) return;
    const attack = enemy.attack || {};
    if (!DANGEROUS_ROUTE_TELEGRAPHS.has(String(attack.kind || ''))) return;
    const samples = attack.kind === 'spiral' ? 20 : 14;
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
    this.ctx.globalAlpha = 0.20 + (1 - remaining) * 0.22;
    this.ctx.strokeStyle = attack.kind === 'charge' ? '#ff6b55' : attack.kind === 'eliteAssault' ? '#ff72da' : palette.glow;
    this.ctx.lineWidth = Math.max(1, dim.min * 0.0022);
    this.ctx.setLineDash([dim.min * 0.010, dim.min * 0.009]);
    this.ctx.shadowBlur = this.vfxGlow(10);
    this.ctx.shadowColor = this.ctx.strokeStyle;
    this.ctx.beginPath();
    let started = false;
    for (let i = 0; i <= samples; i += 1) {
      const point = this.attackPreviewPoint(attack, i / samples);
      if (!point) continue;
      const px = point.x * dim.width;
      const py = point.y * dim.height;
      if (!started) { this.ctx.moveTo(px, py); started = true; }
      else this.ctx.lineTo(px, py);
    }
    if (started) this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.ctx.restore();
  }

  drawAttackTelegraph(enemy, state, dim, palette) {
    const duration = Math.max(0.01, Number(enemy.telegraphDuration || 0.38));
    const remaining = clamp(Number(enemy.telegraphTimer || 0) / duration, 0, 1);
    const pulse = this.reducedMotion ? 1 : 0.7 + Math.sin(this.elapsed * 22) * 0.3;
    const x = state.x * dim.width;
    const y = state.y * dim.height;
    const attack = enemy.attack || {};
    const targetX = Number(attack.targetX ?? this.player.x) * dim.width;
    const targetY = Number(attack.targetY ?? this.player.y) * dim.height;
    const charge = attack.kind === 'charge';

    if (this.safariPortrait) {
      // Gameplay-critical warning stays visible, but WebKit avoids dashed lines,
      // animated dash offsets and multi-pass route drawing.
      this.ctx.save();
      this.ctx.globalAlpha = 0.68 + (1 - remaining) * 0.22;
      this.ctx.strokeStyle = charge ? '#ff715d' : palette.glow;
      this.ctx.lineWidth = Math.max(1.5, dim.min * 0.0032);
      this.ctx.beginPath();
      this.ctx.arc(x, y, state.size * (0.34 + (1 - remaining) * 0.12), 0, Math.PI * 2);
      this.ctx.stroke();
      if (charge) {
        this.ctx.globalAlpha *= 0.72;
        this.ctx.beginPath();
        this.ctx.moveTo(x, y + state.size * 0.20);
        this.ctx.lineTo(targetX, targetY);
        this.ctx.stroke();
      }
      this.ctx.restore();
      return;
    }

    this.drawAttackRouteTelegraph(enemy, state, dim, palette, remaining);

    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
    this.ctx.globalAlpha = (0.45 + (1 - remaining) * 0.40) * pulse;
    this.ctx.strokeStyle = charge ? '#ff715d' : palette.glow;
    this.ctx.lineWidth = Math.max(1, dim.min * (charge ? 0.0045 : 0.0025));
    this.ctx.setLineDash(charge ? [dim.min * 0.025, dim.min * 0.012] : [dim.min * 0.012, dim.min * 0.010]);
    this.ctx.shadowBlur = this.vfxGlow(charge ? 18 : 12);
    this.ctx.shadowColor = charge ? '#ff4d38' : palette.glow;
    if (charge || !DANGEROUS_ROUTE_TELEGRAPHS.has(String(attack.kind || ''))) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, y + state.size * 0.20);
      this.ctx.lineTo(targetX, targetY);
      this.ctx.stroke();
    }
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.arc(x, y, state.size * (0.32 + (1 - remaining) * 0.18), 0, Math.PI * 2);
    this.ctx.stroke();
    if (charge) {
      this.ctx.beginPath();
      this.ctx.arc(targetX, targetY, dim.min * (0.025 + (1 - remaining) * 0.012), 0, Math.PI * 2);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawShooterCharge(enemy, state, dim, palette) {
    const shot = enemy.pendingShot;
    if (!shot) return;
    const progress = 1 - clamp(Number(shot.timer || 0) / Math.max(0.01, Number(shot.duration || 0.4)), 0, 1);
    const x = state.x * dim.width;
    const y = state.y * dim.height + state.size * 0.22;
    const radius = state.size * (0.07 + progress * 0.12);
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
    this.ctx.globalAlpha = 0.68 + progress * 0.30;
    this.ctx.shadowBlur = this.vfxGlow(22);
    this.ctx.shadowColor = enemy.type === 'elite' ? '#ff67e2' : '#ffab62';
    if (this.safariPortrait) {
      this.ctx.fillStyle = enemy.type === 'elite' ? '#ff92ec' : '#ffd092';
      this.ctx.globalAlpha = 0.52 + progress * 0.26;
    } else {
      const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.28, enemy.type === 'elite' ? '#ff92ec' : '#ffd092');
      gradient.addColorStop(1, 'rgba(255,100,45,0)');
      this.ctx.fillStyle = gradient;
    }
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
    const tx = Number(this.player.x) * dim.width;
    const ty = Number(this.player.y) * dim.height;
    this.ctx.globalAlpha = progress * 0.34;
    this.ctx.strokeStyle = palette.glow;
    this.ctx.lineWidth = Math.max(1, dim.min * 0.0018);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(tx, ty);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawCombatEffect(effect, dim) {
    if (Number(effect.age || 0) < 0) return;
    const progress = clamp(Number(effect.age || 0) / Math.max(0.001, Number(effect.duration || 0.2)), 0, 1);
    const fade = 1 - progress;
    const palette = ENEMY_VFX[effect.enemyType] || ENEMY_VFX.fighter;
    const x = Number(effect.x || 0) * dim.width;
    const y = Number(effect.y || 0) * dim.height;

    if (this.safariPortrait && ['energyCloud', 'secondaryBurst', 'coreFlash'].includes(effect.kind)) return;

    if (effect.kind === 'spriteEffect') {
      const image = this.images[effect.spriteKey];
      if (!canDraw(image)) return;
      const size = dim.min * 0.14 * Number(effect.sizeMul || 1) * (0.84 + progress * Number(effect.grow || 0.16));
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite(effect.additive === false ? 'source-over' : 'lighter');
      const pulse = effect.pulse ? (0.78 + Math.sin(progress * Math.PI * 7) * 0.18) : 1;
      this.ctx.globalAlpha = clamp(fade * Number(effect.alphaMul || 1) * pulse, 0, 1);
      this.ctx.shadowBlur = this.vfxGlow(20);
      this.ctx.shadowColor = effect.shadowColor || palette.glow;
      this.drawSprite(image, effect.x, effect.y, size, Number(effect.rotation || 0) + progress * Math.PI * 2 * Number(effect.spin || 0));
      this.ctx.restore();
      return;
    }

    if (effect.kind === 'spark' || effect.kind === 'debris') {
      const radius = Math.max(1, dim.min * (effect.kind === 'debris' ? 0.006 : 0.004) * Number(effect.size || 1) * (1 - progress * 0.35));
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = fade * (effect.kind === 'debris' ? 0.90 : 0.82);
      this.ctx.fillStyle = effect.color || palette.spark;
      this.ctx.shadowBlur = this.vfxGlow(effect.kind === 'debris' ? 10 : 7);
      this.ctx.shadowColor = effect.color || palette.spark;
      if (effect.kind === 'debris') {
        this.ctx.translate(x, y);
        this.ctx.rotate(progress * Math.PI * 4 + Number(effect.size || 1));
        this.ctx.fillRect(-radius * 0.55, -radius * 0.18, radius * 1.1, radius * 0.36);
      } else if (effect.streak && (Number.isFinite(effect.vx) || Number.isFinite(effect.vy))) {
        const speed = Math.hypot(Number(effect.vx || 0) * dim.width, Number(effect.vy || 0) * dim.height) || 1;
        const ux = (Number(effect.vx || 0) * dim.width) / speed;
        const uy = (Number(effect.vy || 0) * dim.height) / speed;
        const streakLength = dim.min * 0.024 * Number(effect.size || 1) * (0.55 + fade * 0.65);
        this.ctx.strokeStyle = effect.color || palette.spark;
        this.ctx.lineWidth = Math.max(1, radius * 0.72);
        this.ctx.lineCap = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(x - ux * streakLength, y - uy * streakLength);
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
        this.ctx.beginPath(); this.ctx.arc(x, y, radius * 0.62, 0, Math.PI * 2); this.ctx.fill();
      } else {
        this.ctx.beginPath(); this.ctx.arc(x, y, radius, 0, Math.PI * 2); this.ctx.fill();
      }
      this.ctx.restore();
      return;
    }

    if (effect.kind === 'coreFlash') {
      const strength = Number(effect.strength || 1);
      const radius = dim.min * (0.028 + progress * 0.060) * strength;
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = Math.pow(fade, 1.6);
      const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.22, '#ecffff');
      gradient.addColorStop(0.52, effect.color || palette.spark);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      this.ctx.fillStyle = gradient;
      this.ctx.shadowBlur = this.vfxGlow(28 * strength);
      this.ctx.shadowColor = effect.color || palette.spark;
      this.ctx.beginPath(); this.ctx.arc(x, y, radius, 0, Math.PI * 2); this.ctx.fill();
      this.ctx.restore();
      return;
    }

    if (effect.kind === 'energyCloud') {
      const strength = Number(effect.strength || 1);
      const radius = dim.min * (0.030 + easeOutCubic(progress) * 0.090) * strength;
      const wobble = Number(effect.seed || 0) * Math.PI * 2;
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = fade * 0.34;
      this.ctx.filter = `blur(${Math.max(2, dim.min * 0.008)}px)`;
      for (let i = 0; i < 3; i += 1) {
        const angle = wobble + i * (Math.PI * 2 / 3);
        const ox = Math.cos(angle) * radius * 0.22 * progress;
        const oy = Math.sin(angle) * radius * 0.16 * progress;
        const r = radius * (0.62 + i * 0.08);
        const cloud = this.ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        cloud.addColorStop(0, i === 0 ? 'rgba(185,230,255,.34)' : 'rgba(84,125,174,.25)');
        cloud.addColorStop(0.35, `${effect.color || palette.burst}33`);
        cloud.addColorStop(1, 'rgba(4,10,24,0)');
        this.ctx.fillStyle = cloud;
        this.ctx.beginPath(); this.ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2); this.ctx.fill();
      }
      this.ctx.restore();
      return;
    }

    if (['impactRing', 'deathRing'].includes(effect.kind)) {
      const strength = Number(effect.strength || 1);
      const radius = dim.min * (effect.kind === 'deathRing' ? 0.025 + progress * 0.105 * strength : 0.018 + progress * 0.055);
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = fade * 0.88;
      this.ctx.strokeStyle = effect.color || palette.burst;
      this.ctx.lineWidth = Math.max(1.2, dim.min * 0.005 * fade);
      this.ctx.shadowBlur = this.vfxGlow(16);
      this.ctx.shadowColor = effect.color || palette.burst;
      this.ctx.beginPath(); this.ctx.arc(x, y, radius, 0, Math.PI * 2); this.ctx.stroke();
      this.ctx.restore();
      return;
    }

    if (effect.kind === 'eliteCross') {
      const radius = dim.min * (0.025 + progress * 0.10);
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = fade * 0.78;
      this.ctx.strokeStyle = effect.color || '#f05cff';
      this.ctx.lineWidth = Math.max(1.5, dim.min * 0.005 * fade);
      this.ctx.shadowBlur = this.vfxGlow(18);
      this.ctx.shadowColor = effect.color || '#f05cff';
      this.ctx.beginPath();
      this.ctx.moveTo(x - radius, y); this.ctx.lineTo(x + radius, y);
      this.ctx.moveTo(x, y - radius); this.ctx.lineTo(x, y + radius);
      this.ctx.stroke();
      this.ctx.restore();
      return;
    }

    if (effect.kind === 'scoreText' || effect.kind === 'comboText' || effect.kind === 'riskText') {
      const isCombo = effect.kind === 'comboText';
      const isRisk = effect.kind === 'riskText';
      const rise = dim.min * (isCombo ? 0.07 : isRisk ? 0.045 : 0.055) * easeOutCubic(progress);
      const scale = isCombo ? 1.05 + Math.sin(progress * Math.PI) * 0.16 : isRisk ? 0.88 : 1;
      this.ctx.save();
      this.ctx.globalAlpha = clamp(fade * (isRisk ? 1.15 : 1.35), 0, 1);
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.font = `900 ${Math.max(10, dim.min * (isCombo ? 0.030 : isRisk ? 0.020 : 0.024) * scale)}px system-ui, sans-serif`;
      this.ctx.fillStyle = effect.color || '#eefcff';
      this.ctx.shadowBlur = this.vfxGlow(isCombo ? 18 : isRisk ? 12 : 10);
      this.ctx.shadowColor = isCombo ? '#54e9ff' : isRisk ? '#ff8d55' : '#93efff';
      this.ctx.fillText(String(effect.text || ''), x, y - rise);
      this.ctx.restore();
      return;
    }

    if (effect.kind === 'bossTarget') {
      const pulse = this.reducedMotion ? 1 : 0.74 + Math.sin(progress * Math.PI * 7) * 0.26;
      const radius = dim.min * (0.028 + progress * 0.022);
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = fade * 0.88 * pulse;
      this.ctx.strokeStyle = '#ff9f67';
      this.ctx.lineWidth = Math.max(1.5, dim.min * 0.0035);
      this.ctx.shadowBlur = this.vfxGlow(18);
      this.ctx.shadowColor = '#ff6c46';
      this.ctx.beginPath(); this.ctx.arc(x, y, radius, 0, Math.PI * 2); this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(x - radius * 1.35, y); this.ctx.lineTo(x - radius * 0.45, y);
      this.ctx.moveTo(x + radius * 0.45, y); this.ctx.lineTo(x + radius * 1.35, y);
      this.ctx.moveTo(x, y - radius * 1.35); this.ctx.lineTo(x, y - radius * 0.45);
      this.ctx.moveTo(x, y + radius * 0.45); this.ctx.lineTo(x, y + radius * 1.35);
      this.ctx.stroke();
      this.ctx.restore();
      return;
    }

    if (effect.kind === 'shotCharge') {
      const radius = dim.min * (0.015 + progress * 0.028);
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = fade * 0.72;
      this.ctx.strokeStyle = palette.glow;
      this.ctx.lineWidth = Math.max(1, dim.min * 0.003);
      this.ctx.shadowBlur = this.vfxGlow(14);
      this.ctx.shadowColor = palette.glow;
      this.ctx.beginPath(); this.ctx.arc(x, y, radius, 0, Math.PI * 2); this.ctx.stroke();
      this.ctx.restore();
      return;
    }

    if (effect.kind === 'enemyMuzzle') {
      const radius = dim.min * ((effect.charged ? 0.034 : 0.022) * (0.7 + Math.sin(progress * Math.PI) * 0.55));
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = fade * 0.90;
      if (this.safariPortrait) {
        // Enemy fire starts ~0.75 s into a wave. Avoid allocating a fresh radial
        // gradient for every muzzle frame at the exact point Safari used to drop.
        this.ctx.fillStyle = effect.charged ? '#ffd08f' : palette.spark;
      } else {
        const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.26, effect.charged ? '#ffd08f' : palette.spark);
        gradient.addColorStop(1, 'rgba(255,90,40,0)');
        this.ctx.fillStyle = gradient;
      }
      this.ctx.shadowBlur = this.vfxGlow(effect.charged ? 20 : 12);
      this.ctx.shadowColor = effect.charged ? '#ff8b4d' : palette.glow;
      this.ctx.beginPath(); this.ctx.arc(x, y, radius, 0, Math.PI * 2); this.ctx.fill();
      this.ctx.restore();
      return;
    }

    if (effect.kind === 'secondaryBurst') {
      const radius = dim.min * (0.025 + progress * 0.065);
      this.ctx.save();
      this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
      this.ctx.globalAlpha = fade * 0.74;
      const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(0.25, effect.color || palette.burst); gradient.addColorStop(1, 'rgba(255,130,60,0)');
      this.ctx.fillStyle = gradient;
      this.ctx.beginPath(); this.ctx.arc(x, y, radius, 0, Math.PI * 2); this.ctx.fill();
      this.ctx.restore();
      return;
    }

    let image = this.images.hit;
    let size = dim.min * 0.14 * (0.8 + progress * 0.35);
    if (effect.kind === 'explosion') {
      image = this.images.explosion;
      const typeScale = effect.enemyType === 'heavy' ? 1.22 : effect.enemyType === 'elite' ? 1.32 : effect.enemyType === 'charger' ? 1.15 : 1;
      size = dim.min * 0.17 * typeScale * (0.78 + progress * 0.45);
    } else if (effect.kind === 'spawn') {
      image = this.images.spawn; size = dim.min * 0.14 * (0.78 + progress * 0.24);
    } else if (effect.kind === 'warning') {
      image = this.images.diveWarning; size = dim.min * 0.13 * (0.9 + Math.sin(progress * Math.PI) * 0.25);
    } else if (effect.kind === 'chargeImpact') {
      image = this.images.chargeImpact; size = dim.min * 0.16 * (0.9 + progress * 0.25);
    } else if (effect.kind === 'bomb') {
      image = this.images.bomb; size = dim.min * 0.45 * (0.75 + progress * 0.6);
    }
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite(['explosion', 'chargeImpact'].includes(effect.kind) ? 'lighter' : 'source-over');
    this.ctx.globalAlpha = effect.kind === 'warning' ? fade * 0.90 : fade;
    if (effect.kind === 'explosion') {
      this.ctx.shadowBlur = this.vfxGlow(20);
      this.ctx.shadowColor = effect.color || palette.burst;
    }
    this.drawSprite(image, effect.x, effect.y, size);
    this.ctx.restore();
  }

  drawProjectileTrail(bullet, dim, { color = '#bdf8ff', length = 0.055, width = 0.010, glow = 12, alpha = 0.85, composite = 'lighter' } = {}) {
    const screenVx = Number(bullet.vx || 0) * dim.width;
    const screenVy = Number(bullet.vy || 0) * dim.height;
    const magnitude = Math.hypot(screenVx, screenVy);
    if (magnitude < 0.00001) return;
    const ux = screenVx / magnitude;
    const uy = screenVy / magnitude;
    const x = bullet.x * dim.width;
    const y = bullet.y * dim.height;
    const tailLength = dim.min * length * (this.mobilePortrait ? 0.72 : 1);
    const tailX = x - ux * tailLength;
    const tailY = y - uy * tailLength;
    let strokeStyle = color;
    if (!this.mobilePortrait) {
      const gradient = this.ctx.createLinearGradient(x, y, tailX, tailY);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.22, color);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      strokeStyle = gradient;
    }
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite(composite);
    this.ctx.globalAlpha = alpha * (this.mobilePortrait ? 0.72 : 1);
    this.ctx.strokeStyle = strokeStyle;
    this.ctx.lineWidth = Math.max(1, dim.min * width);
    this.ctx.lineCap = 'round';
    this.ctx.shadowBlur = this.vfxGlow(this.reducedMotion ? glow * 0.45 : glow);
    this.ctx.shadowColor = color;
    this.ctx.beginPath();
    this.ctx.moveTo(tailX, tailY);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawPlayerProjectile(bullet, dim) {
    const overdrive = bullet.sprite === 'playerBulletOverdrive';
    const portraitOverdrive = this.mobilePortrait && overdrive;
    const pulse = 1 + Math.sin(Number(bullet.age || 0) * 34) * (this.reducedMotion ? 0.015 : 0.04);
    if (!this.safariPortrait) this.drawProjectileTrail(bullet, dim, {
      color: overdrive ? '#b6ffff' : '#66dcff',
      length: portraitOverdrive ? 0.052 : (overdrive ? 0.082 : 0.060),
      width: portraitOverdrive ? 0.008 : (overdrive ? 0.012 : 0.009),
      glow: portraitOverdrive ? 7 : (overdrive ? 20 : 14),
      alpha: portraitOverdrive ? 0.72 : 0.92,
      composite: portraitOverdrive ? 'source-over' : 'lighter'
    });
    const screenVx = Number(bullet.vx || 0) * dim.width;
    const screenVy = Number(bullet.vy || 0) * dim.height;
    const rotation = Math.hypot(screenVx, screenVy) > 0.00001
      ? Math.atan2(screenVy, screenVx) + Math.PI / 2
      : 0;
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite(portraitOverdrive ? 'source-over' : 'lighter');
    this.ctx.shadowBlur = this.vfxGlow(portraitOverdrive ? 6 : (overdrive ? 20 : 12));
    this.ctx.shadowColor = '#6ce9ff';
    this.drawSprite(
      this.images[bullet.sprite] || this.images.playerBullet,
      bullet.x,
      bullet.y,
      dim.playerBulletSize * (overdrive ? 1.10 : 1) * pulse,
      rotation
    );
    this.ctx.restore();
  }

  drawEnemyProjectile(bullet, dim) {
    const sprite = String(bullet.sprite || 'fighterBullet');
    const dangerous = Boolean(bullet.charged) || /charged|special|finalBoss|miniBoss/i.test(sprite);
    const spec = PROJECTILE_VFX[sprite] || {};
    const color = bullet.trailColor || spec.color || (dangerous ? '#ffb36a' : '#ff704f');
    const pulse = 1 + Math.sin(Number(bullet.age || 0) * 28) * (this.reducedMotion ? 0.01 : (dangerous ? 0.05 : 0.025));
    if (!this.safariPortrait && (!this.mobilePortrait || dangerous)) {
      this.drawProjectileTrail(bullet, dim, {
        color,
        length: Number(spec.length || (dangerous ? 0.080 : 0.052)),
        width: Number(spec.width || (dangerous ? 0.0125 : 0.008)),
        glow: Number(spec.glow || (dangerous ? 20 : 13)),
        alpha: dangerous ? 0.95 : 0.82
      });
    }
    const screenVx = Number(bullet.vx || 0) * dim.width;
    const screenVy = Number(bullet.vy || 0) * dim.height;
    const rotation = Math.hypot(screenVx, screenVy) > 0.00001
      ? Math.atan2(screenVy, screenVx) + Math.PI / 2
      : Math.PI;
    const dangerReadabilityScale = dangerous ? 1.06 : 1;
    const sizeScale = Number(spec.scale || 1) * Number(bullet.sizeMul || bullet.scale || 1) * (bullet.charged ? 1.18 : 1) * dangerReadabilityScale;
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
    this.ctx.shadowBlur = this.vfxGlow(Number(spec.glow || (dangerous ? 18 : 10)));
    this.ctx.shadowColor = color;
    this.drawSprite(
      this.images[bullet.sprite] || this.images.fighterBullet,
      bullet.x,
      bullet.y,
      dim.enemyBulletSize * sizeScale * pulse,
      rotation
    );
    this.ctx.restore();
  }

  drawThrusterParticles(dim) {
    if (this.safariPortrait || !this.thrusterParticles?.length) return;
    const portraitOverdrive = this.mobilePortrait && this.overdriveTimer > 0;
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite(portraitOverdrive ? 'source-over' : 'lighter');
    for (const particle of this.thrusterParticles) {
      const progress = clamp(particle.age / Math.max(0.001, particle.duration), 0, 1);
      const alpha = (1 - progress) * (particle.overdrive ? 0.78 : 0.58);
      const radius = Math.max(1, dim.min * 0.0055 * particle.size * (1 - progress * 0.35));
      const x = particle.x * dim.width;
      const y = particle.y * dim.height;
      this.ctx.globalAlpha = alpha;
      this.ctx.fillStyle = particle.overdrive ? '#dcffff' : '#63ddff';
      this.ctx.shadowBlur = this.vfxGlow(portraitOverdrive && particle.overdrive ? 4 : (particle.overdrive ? 16 : 10));
      this.ctx.shadowColor = '#4fd8ff';
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  drawPlayerMotionTrail(dim, visualY) {
    if (this.safariPortrait) return;
    const points = this.playerVfx?.trailPoints || [];
    if (points.length < 2) return;
    const overdrive = this.overdriveTimer > 0;
    const portraitOverdrive = this.mobilePortrait && overdrive;
    const engineOffsets = [-0.075, 0.075];
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite(portraitOverdrive ? 'source-over' : 'lighter');
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    for (const side of engineOffsets) {
      const path = new Path2D();
      points.forEach((point, index) => {
        const age = Number(point.age || 0);
        const tailDrift = age * (overdrive ? 0.22 : 0.16);
        const x = (Number(point.x || this.player.x) + side * 0.11 - Number(point.tilt || 0) * age * 0.045) * dim.width;
        const y = (Number(point.y || visualY) + 0.030 + tailDrift) * dim.height;
        if (index === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      const newestLife = clamp(1 - Number(points[0]?.age || 0) / 0.24, 0, 1);
      this.ctx.globalAlpha = (portraitOverdrive ? 0.46 : (overdrive ? 0.72 : 0.48)) * newestLife;
      this.ctx.strokeStyle = overdrive ? '#c9ffff' : '#60ddff';
      this.ctx.lineWidth = Math.max(1.25, dim.min * (portraitOverdrive ? 0.0044 : (overdrive ? 0.0060 : 0.0042)));
      this.ctx.shadowBlur = this.vfxGlow(portraitOverdrive ? 5 : (overdrive ? 22 : 14));
      this.ctx.shadowColor = '#55dfff';
      this.ctx.stroke(path);
    }
    this.ctx.restore();
  }

  drawPlayerThruster(dim, visualY) {
    const x = this.player.x * dim.width;
    const y = visualY * dim.height + dim.playerSize * 0.31;
    const moving = clamp(Math.abs(this.playerVfx?.visualVx || 0) / 0.8, 0, 1);
    const overdrive = this.overdriveTimer > 0;
    const pulse = this.reducedMotion ? 1 : 1 + Math.sin(this.elapsed * (overdrive ? 28 : 21)) * 0.12;
    const length = dim.playerSize * (overdrive ? 0.72 : 0.48) * pulse * (1 + moving * 0.16);
    const halfWidth = dim.playerSize * (overdrive ? 0.105 : 0.078);
    const tiltShift = (this.playerVfx?.tilt || 0) * dim.playerSize * 0.55;
    const portraitOverdrive = this.mobilePortrait && overdrive;
    const liteThruster = this.safariPortrait || portraitOverdrive;
    let thrusterFill = overdrive ? 'rgba(155,245,255,.82)' : 'rgba(96,225,255,.76)';
    if (!liteThruster) {
      const gradient = this.ctx.createLinearGradient(x, y, x - tiltShift, y + length);
      gradient.addColorStop(0, 'rgba(245,255,255,.98)');
      gradient.addColorStop(0.24, overdrive ? 'rgba(113,246,255,.92)' : 'rgba(74,214,255,.88)');
      gradient.addColorStop(1, 'rgba(21,102,255,0)');
      thrusterFill = gradient;
    }
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite(liteThruster ? 'source-over' : 'lighter');
    this.ctx.fillStyle = thrusterFill;
    this.ctx.shadowBlur = this.vfxGlow(portraitOverdrive ? 4 : (overdrive ? 24 : 16));
    this.ctx.shadowColor = '#54dcff';
    this.ctx.beginPath();
    this.ctx.moveTo(x - halfWidth, y);
    this.ctx.quadraticCurveTo(x - tiltShift * 0.35, y + length * 0.46, x - tiltShift, y + length);
    this.ctx.quadraticCurveTo(x + tiltShift * 0.10, y + length * 0.48, x + halfWidth, y);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();
  }

  drawMuzzleFlash(dim, visualY) {
    const timer = clamp((this.playerVfx?.muzzleTimer || 0) / 0.10, 0, 1);
    const overdrive = this.overdriveTimer > 0;
    const anchors = overdrive ? [-0.018, 0.018] : [0];

    // Overdrive fires more often and from two muzzles. On portrait mobile use a
    // small solid flash instead of allocating four gradients for every shot.
    if (this.safariPortrait || (this.mobilePortrait && overdrive)) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = timer * 0.78;
      this.ctx.fillStyle = '#bffbff';
      this.ctx.strokeStyle = '#86efff';
      this.ctx.lineCap = 'round';
      for (const offset of anchors) {
        const x = (this.player.x + offset) * dim.width;
        const y = visualY * dim.height - dim.playerSize * 0.37;
        const radius = dim.playerSize * (0.075 + timer * 0.035);
        this.ctx.beginPath(); this.ctx.arc(x, y, radius, 0, Math.PI * 2); this.ctx.fill();
        const lance = dim.playerSize * 0.24 * timer;
        this.ctx.lineWidth = Math.max(1, dim.playerSize * 0.018 * timer);
        this.ctx.beginPath(); this.ctx.moveTo(x, y); this.ctx.lineTo(x, y - lance); this.ctx.stroke();
      }
      this.ctx.restore();
      return;
    }

    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
    for (const offset of anchors) {
      const x = (this.player.x + offset) * dim.width;
      const y = visualY * dim.height - dim.playerSize * 0.37;
      const radius = dim.playerSize * (0.10 + timer * 0.055);
      const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, 'rgba(255,255,255,.98)');
      gradient.addColorStop(0.35, 'rgba(121,241,255,.92)');
      gradient.addColorStop(1, 'rgba(49,166,255,0)');
      this.ctx.globalAlpha = timer;
      this.ctx.fillStyle = gradient;
      this.ctx.shadowBlur = this.vfxGlow(18);
      this.ctx.shadowColor = '#78edff';
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fill();

      // Short vertical lance gives the muzzle flash a directional weapon read.
      const lance = dim.playerSize * (overdrive ? 0.34 : 0.24) * timer;
      const streak = this.ctx.createLinearGradient(x, y, x, y - lance);
      streak.addColorStop(0, 'rgba(255,255,255,.98)');
      streak.addColorStop(0.35, 'rgba(118,239,255,.84)');
      streak.addColorStop(1, 'rgba(65,175,255,0)');
      this.ctx.strokeStyle = streak;
      this.ctx.lineWidth = Math.max(1.25, dim.playerSize * (overdrive ? 0.030 : 0.022) * timer);
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(x, y);
      this.ctx.lineTo(x, y - lance);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawPlayerHitFeedback(dim) {
    const timer = clamp((this.playerVfx?.hitTimer || 0) / 0.42, 0, 1);
    const progress = 1 - timer;
    const x = Number(this.playerVfx?.hitX ?? this.player.x) * dim.width;
    const y = Number(this.playerVfx?.hitY ?? this.player.y) * dim.height;
    const radius = dim.playerSize * (0.46 + progress * 0.72);
    this.ctx.save();
    this.ctx.globalCompositeOperation = this.vfxComposite('lighter');
    this.ctx.globalAlpha = timer * 0.92;
    this.ctx.strokeStyle = '#ffb59d';
    this.ctx.lineWidth = Math.max(2, dim.min * 0.006 * timer);
    this.ctx.shadowBlur = this.vfxGlow(18);
    this.ctx.shadowColor = '#ff6d58';
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.globalAlpha = timer * 0.28;
    this.ctx.fillStyle = '#ff654f';
    this.ctx.fillRect(0, 0, dim.width, dim.height);
    this.ctx.restore();
  }

  drawBossHealth(boss, dim) {
    const portrait = dim.height > dim.width;
    const compactLandscape = !portrait && dim.height <= 560;
    const width = dim.width * (portrait ? 0.72 : compactLandscape ? 0.40 : 0.40);
    const height = Math.max(9, dim.min * 0.019);
    const x = dim.width * 0.5 - width / 2;
    // UI Patch 3 turns the boss HP into one clean status band below the primary HUD.
    // Wave/Mini-Boss labels are no longer duplicated by a persistent DOM chip.
    const y = portrait
      ? Math.max(dim.height * 0.092, 66)
      : compactLandscape
        ? Math.max(dim.height * 0.155, 82)
        : Math.max(dim.height * 0.132, 104);
    const ratio = clamp(Number(boss.hp || 0) / Math.max(1, Number(boss.maxHp || 1)), 0, 1);
    const final = boss.type === 'finalBoss';
    if (this.safariPortrait) {
      this.ctx.save();
      this.ctx.globalAlpha = 0.96;
      this.ctx.fillStyle = 'rgba(1, 8, 22, .92)';
      this.ctx.fillRect(x - 2, y - 2, width + 4, height + 4);
      this.ctx.fillStyle = 'rgba(7, 22, 43, .98)';
      this.ctx.fillRect(x, y, width, height);
      const fillWidth = Math.max(0, (width - 4) * ratio);
      if (fillWidth > 0) {
        this.ctx.fillStyle = final ? '#ff7650' : '#63dfff';
        this.ctx.fillRect(x + 2, y + 2, fillWidth, Math.max(1, height - 4));
      }
      this.ctx.strokeStyle = final ? '#ff9a6c' : '#70e7ff';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x, y, width, height);
      this.ctx.restore();
      return;
    }
    const phase = final ? this.finalBossPhase(boss) : this.miniBossPhase(boss);
    const percent = Math.round(ratio * 100);

    this.ctx.save();
    this.ctx.globalAlpha = 0.96;

    // Dark track + inner bevel keeps the bar readable over bright nebulae.
    this.ctx.fillStyle = 'rgba(1, 8, 22, .90)';
    this.ctx.fillRect(x - 3, y - 3, width + 6, height + 6);
    this.ctx.fillStyle = 'rgba(7, 22, 43, .96)';
    this.ctx.fillRect(x, y, width, height);

    const fillWidth = Math.max(0, (width - 4) * ratio);
    if (fillWidth > 0) {
      const gradient = this.ctx.createLinearGradient(x + 2, y, x + width - 2, y);
      if (final) {
        gradient.addColorStop(0, '#ffcf67');
        gradient.addColorStop(0.62, '#ff7a48');
        gradient.addColorStop(1, '#ff3f55');
      } else {
        gradient.addColorStop(0, '#dffcff');
        gradient.addColorStop(0.55, '#6be8ff');
        gradient.addColorStop(1, '#4ba7ff');
      }
      this.ctx.fillStyle = gradient;
      this.ctx.shadowBlur = this.vfxGlow(final ? 14 : 11);
      this.ctx.shadowColor = final ? 'rgba(255,97,55,.72)' : 'rgba(79,224,255,.70)';
      this.ctx.fillRect(x + 2, y + 2, fillWidth, Math.max(1, height - 4));
      this.ctx.shadowBlur = this.vfxGlow(0);
    }

    this.ctx.strokeStyle = final ? 'rgba(255, 132, 76, .92)' : 'rgba(99, 222, 255, .88)';
    this.ctx.lineWidth = Math.max(1, dim.min * 0.0025);
    this.ctx.strokeRect(x, y, width, height);

    // Phase threshold markers keep both boss encounters readable without extra panels.
    this.ctx.strokeStyle = 'rgba(255,255,255,.34)';
    this.ctx.lineWidth = Math.max(1, dim.min * 0.0015);
    const thresholds = final ? [0.33, 0.67] : [0.50];
    for (const threshold of thresholds) {
      const markerX = x + width * threshold;
      this.ctx.beginPath();
      this.ctx.moveTo(markerX, y + 1);
      this.ctx.lineTo(markerX, y + height - 1);
      this.ctx.stroke();
    }

    const labelY = y - Math.max(8, dim.min * 0.013);
    this.ctx.font = `800 ${Math.max(10, dim.min * 0.020)}px system-ui, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = final ? '#fff0dd' : '#e9fbff';
    this.ctx.shadowBlur = this.vfxGlow(9);
    this.ctx.shadowColor = final ? 'rgba(255,112,64,.55)' : 'rgba(89,220,255,.45)';
    const label = final ? `FINAL BOSS  •  PHASE ${phase}  •  ${percent}%` : `MINI BOSS  •  PHASE ${phase}  •  ${percent}%`;
    this.ctx.fillText(label, dim.width * 0.5, labelY);
    this.ctx.restore();
  }

  drawPatternBanner(label, dim) {
    if (this.safariPortrait) return;
    const alpha = clamp(this.patternBanner.timer / 0.35, 0, 1);
    const text = String(label || 'PATTERN').toUpperCase();
    this.ctx.save();
    this.ctx.globalAlpha = Math.min(0.92, alpha);
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = `700 ${Math.max(13, dim.min * 0.035)}px system-ui, sans-serif`;
    this.ctx.shadowBlur = this.vfxGlow(12);
    this.ctx.shadowColor = '#5ee7ff';
    this.ctx.fillStyle = '#e9fbff';
    this.ctx.fillText(text, dim.width * 0.5, dim.height * 0.48);
    this.ctx.restore();
  }

  safariHalfTurnSprite(image) {
    if (!this.safariPortrait || !canDraw(image)) return null;
    const cached = this.safariHalfTurnSpriteCache.get(image);
    if (cached) return cached;

    const sourceW = Math.max(1, Number(image.naturalWidth || image.width || 1));
    const sourceH = Math.max(1, Number(image.naturalHeight || image.height || 1));
    const maxSide = 384;
    const scale = Math.min(1, maxSide / Math.max(sourceW, sourceH));
    const width = Math.max(1, Math.round(sourceW * scale));
    const height = Math.max(1, Math.round(sourceH * scale));
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const cacheCtx = surface.getContext('2d', { alpha: true });
    if (!cacheCtx) return null;
    cacheCtx.translate(width, height);
    cacheCtx.rotate(Math.PI);
    cacheCtx.drawImage(image, 0, 0, width, height);
    this.safariHalfTurnSpriteCache.set(image, surface);
    return surface;
  }

  drawSprite(image, nx, ny, sizePx, rotation = 0) {
    if (!canDraw(image)) return;
    const x = nx * this.canvas.width;
    const y = ny * this.canvas.height;

    if (Math.abs(rotation) < 0.00001) {
      this.ctx.drawImage(image, x - sizePx / 2, y - sizePx / 2, sizePx, sizePx);
      return;
    }

    // Most formation enemies sit at exactly PI. Safari can draw the cached
    // half-turn image directly instead of rebuilding a transform stack 60x/sec.
    if (this.safariPortrait && Math.abs(Math.abs(rotation) - Math.PI) < 0.00001) {
      const cached = this.safariHalfTurnSprite(image);
      if (cached) {
        this.ctx.drawImage(cached, x - sizePx / 2, y - sizePx / 2, sizePx, sizePx);
        return;
      }
    }

    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(rotation);
    this.ctx.drawImage(image, -sizePx / 2, -sizePx / 2, sizePx, sizePx);
    this.ctx.restore();
  }
}

export { ENEMY, PATTERNS };
