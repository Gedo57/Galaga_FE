import { waveDefinition } from './waveConfig.js';

// Patch 4 — production asset lifecycle.
// Gameplay sprites share one lazy image cache across engine instances. Only the
// assets needed by the active wave are decoded/retained on mobile instead of
// allocating the complete game sprite set every time CoreGameplayEngine mounts.
export const GAMEPLAY_ASSETS = Object.freeze({
  player: '/assets/player/ship.png',
  playerBullet: '/assets/player/bullet-01.png',
  playerBulletOverdrive: '/assets/player/bullet-02.png',
  shield: '/assets/player/shield.png',
  overdrive: '/assets/player/overdrive.png',
  bomb: '/assets/player/bomb.png',
  fighter: '/assets/enemies/Enemy_01_Fighter.png',
  fighterBullet: '/assets/enemies/Enemy_01_Fighter_Bullet_01.png',
  diver: '/assets/enemies/Enemy_02_Diver.png',
  diverBullet: '/assets/enemies/Enemy_02_Diver_Bullet_01.png',
  diveTrail: '/assets/enemies/Enemy_02_Dive_Trail_01.png',
  diveWarning: '/assets/enemies/Enemy_02_Dive_Warning_01.png',
  shooter: '/assets/enemies/Enemy_03_Shooter.png',
  shooterBullet: '/assets/enemies/Enemy_03_Shooter_Bullet_01.png',
  shooterCharged: '/assets/enemies/Enemy_03_Shooter_ChargedShot_01.png',
  heavy: '/assets/enemies/Enemy_04_Heavy.png',
  heavyBullet: '/assets/enemies/Enemy_04_Heavy_Bullet_01.png',
  charger: '/assets/enemies/Enemy_05_Charger.png',
  chargeTrail: '/assets/enemies/Enemy_05_Charge_Trail_01.png',
  chargeImpact: '/assets/enemies/Enemy_05_Charge_Impact_01.png',
  elite: '/assets/enemies/Enemy_06_Elite.png',
  eliteBullet: '/assets/enemies/Enemy_06_Elite_Bullet_01.png',
  eliteSpecial: '/assets/enemies/Enemy_06_Elite_Special_Bullet_01.png',
  spawn: '/assets/vfx/Enemy_Spawn_Effect_01.png',
  hit: '/assets/vfx/Hit_Impact_01.png',
  explosion: '/assets/vfx/Explosion_Generic_01.png',
  miniBoss: '/assets/bosses/MiniBoss_01.png',
  miniBossBullet: '/assets/bosses/MiniBoss_Bullet_01.png',
  miniBossSpread: '/assets/bosses/MiniBoss_Spread_Bullet_01.png',
  miniBossPhaseAura: '/assets/bosses/MiniBoss_Phase2_Aura_01.png',
  miniBossPhaseBurst: '/assets/bosses/MiniBoss_Phase2_Transition_01.png',
  miniBossTripleBullet: '/assets/bosses/MiniBoss_TripleAim_Bullet_01.png',
  miniBossTriOrbCharge: '/assets/bosses/MiniBoss_TripleAim_Charge_01.png',
  miniBossArcBullet: '/assets/bosses/MiniBoss_Arc_Sweep_Bullet_01.png',
  miniBossAlternatingBullet: '/assets/bosses/MiniBoss_Alternating_Spread_Bullet_01.png',
  miniBossTargetReticle: '/assets/bosses/MiniBoss_Target_Reticle_01.png',
  miniBossHeavyCharge: '/assets/bosses/MiniBoss_Heavy_Charge_01.png',
  miniBossHeavyProjectile: '/assets/bosses/MiniBoss_Heavy_Projectile_01.png',
  finalBoss: '/assets/bosses/FinalBoss_01.png',
  finalBossBullet: '/assets/bosses/FinalBoss_Bullet_01.png',
  finalBossSpread: '/assets/bosses/FinalBoss_Spread_Bullet_01.png',
  finalBossLaserTelegraph: '/assets/bosses/FinalBoss_Laser_Telegraph_01.png',
  finalBossLaserBeam: '/assets/bosses/FinalBoss_Laser_Beam_01.png'
});

const CORE_GAMEPLAY_KEYS = Object.freeze([
  'player', 'playerBullet', 'playerBulletOverdrive', 'shield', 'overdrive', 'bomb',
  'spawn', 'hit', 'explosion'
]);

const ENEMY_ASSET_KEYS = Object.freeze({
  fighter: Object.freeze(['fighter', 'fighterBullet']),
  diver: Object.freeze(['diver', 'diverBullet', 'diveTrail', 'diveWarning']),
  shooter: Object.freeze(['shooter', 'shooterBullet', 'shooterCharged']),
  heavy: Object.freeze(['heavy', 'heavyBullet']),
  // Chargers use the generic fighter projectile when they fire outside a charge.
  charger: Object.freeze(['charger', 'chargeTrail', 'chargeImpact', 'fighterBullet']),
  elite: Object.freeze(['elite', 'eliteBullet', 'eliteSpecial']),
  miniBoss: Object.freeze([
    'miniBoss', 'miniBossBullet', 'miniBossSpread', 'miniBossPhaseAura', 'miniBossPhaseBurst',
    'miniBossTripleBullet', 'miniBossTriOrbCharge', 'miniBossArcBullet',
    'miniBossAlternatingBullet', 'miniBossTargetReticle', 'miniBossHeavyCharge',
    'miniBossHeavyProjectile'
  ]),
  finalBoss: Object.freeze([
    'finalBoss', 'finalBossBullet', 'finalBossSpread',
    'finalBossLaserTelegraph', 'finalBossLaserBeam'
  ])
});

const imageCache = new Map();
const loadPromises = new Map();
const PRELOAD_TIMEOUT_MS = 20000;
const PRELOAD_CONCURRENCY = 4;

function uniqueKeys(keys = []) {
  return [...new Set(keys)].filter((key) => Boolean(GAMEPLAY_ASSETS[key]));
}

export function gameplayAssetKeysForWave(wave, difficulty = 'medium') {
  const def = waveDefinition(Math.max(1, Math.min(10, Number(wave) || 1)), difficulty);
  const keys = [...CORE_GAMEPLAY_KEYS];
  for (const [type, count] of Object.entries(def?.mix || {})) {
    if (Number(count || 0) <= 0) continue;
    keys.push(...(ENEMY_ASSET_KEYS[type] || []));
  }
  return uniqueKeys(keys);
}

export function getGameplayImage(key) {
  const src = GAMEPLAY_ASSETS[key];
  if (!src) return null;
  let image = imageCache.get(key);
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.src = src;
    imageCache.set(key, image);
  }
  return image;
}

function waitForGameplayImage(key) {
  const image = getGameplayImage(key);
  if (!image) return Promise.resolve({ key, url: '', ok: false });
  if (image.complete) return Promise.resolve({ key, url: GAMEPLAY_ASSETS[key], ok: image.naturalWidth > 0 });
  if (loadPromises.has(key)) return loadPromises.get(key);

  const promise = new Promise((resolve) => {
    let settled = false;
    const finish = async (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      if (ok && typeof image.decode === 'function') {
        try { await image.decode(); } catch {}
      }
      resolve({ key, url: GAMEPLAY_ASSETS[key], ok: Boolean(ok && image.naturalWidth > 0) });
    };
    const onLoad = () => finish(true);
    const onError = () => finish(false);
    const timer = window.setTimeout(() => finish(false), PRELOAD_TIMEOUT_MS);
    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onError, { once: true });
    // Cover a cache hit that completed between the first complete check and listener setup.
    if (image.complete) queueMicrotask(() => finish(image.naturalWidth > 0));
  }).finally(() => loadPromises.delete(key));

  loadPromises.set(key, promise);
  return promise;
}

export async function preloadGameplayAssetKeys(keys, { onProgress } = {}) {
  const assets = uniqueKeys(keys);
  const results = new Array(assets.length);
  let cursor = 0;
  let completed = 0;

  const worker = async () => {
    while (cursor < assets.length) {
      const index = cursor++;
      const result = await waitForGameplayImage(assets[index]);
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
    failed: results.filter((item) => item && !item.ok).map((item) => item.url || item.key)
  };
}

export function preloadGameplayAssetsForWave(wave, difficulty = 'medium', options = {}) {
  return preloadGameplayAssetKeys(gameplayAssetKeysForWave(wave, difficulty), options);
}

// Drop decoded images that are not needed by the next active wave. This is only
// called while no gameplay engine is rendering, so an active draw never loses a sprite.
export function retainGameplayAssetKeys(keys = []) {
  const keep = new Set(uniqueKeys(keys));
  for (const [key, image] of imageCache.entries()) {
    if (keep.has(key)) continue;
    loadPromises.delete(key);
    try {
      image.removeAttribute('src');
      image.src = '';
    } catch {}
    imageCache.delete(key);
  }
}

export function retainGameplayAssetsForWave(wave, difficulty = 'medium') {
  retainGameplayAssetKeys(gameplayAssetKeysForWave(wave, difficulty));
}

export function createGameplayImageView() {
  const view = Object.create(null);
  for (const key of Object.keys(GAMEPLAY_ASSETS)) {
    Object.defineProperty(view, key, {
      enumerable: true,
      configurable: false,
      get: () => getGameplayImage(key)
    });
  }
  return view;
}

export function gameplayAssetCacheStats() {
  return { decodedOrLoading: imageCache.size, keys: [...imageCache.keys()] };
}
