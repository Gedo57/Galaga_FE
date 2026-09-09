const STORAGE_KEY = 'galaga-audio-settings-v1';

const MUSIC_TRACKS = Object.freeze({
  menu: '/assets/audio/music-main-menu.mp3',
  gameplay: '/assets/audio/music-gameplay.mp3'
});

const SFX_TRACKS = Object.freeze({
  coinSpend: '/assets/audio/sfx-coin-spend.mp3',
  chargeUp: '/assets/audio/sfx-charge-up.mp3',
  explosion: '/assets/audio/sfx-explosion.mp3',
  laser: '/assets/audio/sfx-laser.mp3',
  enemyFire: '/assets/audio/sfx-enemy-fire.mp3',
  enemyDestroy: '/assets/audio/sfx-enemy-destroy.mp3',
  waveStart: '/assets/audio/sfx-wave-start.mp3',
  waveClear: '/assets/audio/sfx-wave-clear.mp3',
  diveFlyby: '/assets/audio/sfx-dive-flyby.mp3',
  bombBlast: '/assets/audio/sfx-bomb-blast.mp3'
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function isSafariBrowser() {
  const ua = String(navigator.userAgent || '');
  const vendor = String(navigator.vendor || '');
  return /Apple/i.test(vendor) && /WebKit/i.test(ua) && /Safari/i.test(ua)
    && !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA|Chrome|Chromium|Edg|OPR|Firefox)/i.test(ua);
}
function isSafariTouchDevice() {
  const ua = String(navigator.userAgent || '');
  const platform = String(navigator.platform || '');
  const iosDevice = /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isSafariBrowser() && iosDevice;
}
function isSafariDesktopDevice() {
  if (!isSafariBrowser() || isSafariTouchDevice()) return false;
  return /Macintosh|Mac OS X/i.test(String(navigator.userAgent || '')) || /^Mac/i.test(String(navigator.platform || ''));
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      muted: Boolean(saved.muted),
      musicVolume: Number.isFinite(Number(saved.musicVolume)) ? clamp01(saved.musicVolume) : 0.60,
      sfxVolume: Number.isFinite(Number(saved.sfxVolume)) ? clamp01(saved.sfxVolume) : 0.75
    };
  } catch {
    return { muted: false, musicVolume: 0.60, sfxVolume: 0.75 };
  }
}

class AudioManager {
  constructor() {
    this.settings = loadSettings();
    this.unlocked = false;
    this.currentMusicKey = null;
    // WebKit has a much higher cost for many simultaneous HTMLAudio decoders.
    // Keep a bounded pool profile on touch Safari; Chrome/desktop behavior stays unchanged.
    this.safariTouch = isSafariTouchDevice();
    this.safariDesktop = isSafariDesktopDevice();
    this.safariOptimized = this.safariTouch || this.safariDesktop;
    this.music = Object.fromEntries(Object.entries(MUSIC_TRACKS).map(([key, src]) => {
      const node = new Audio(src);
      node.loop = true;
      node.preload = 'auto';
      node.playsInline = true;
      return [key, node];
    }));
    this.sfxPools = new Map();
    this.lastSfxAt = new Map();
    this.applyMusicVolume();
  }

  snapshot() {
    return { ...this.settings };
  }

  persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch {}
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.playCurrentMusic();
  }

  setMusicTrack(key) {
    const normalized = MUSIC_TRACKS[key] ? key : null;
    if (normalized === this.currentMusicKey) {
      if (this.unlocked) this.playCurrentMusic();
      return;
    }
    for (const [musicKey, node] of Object.entries(this.music)) {
      if (musicKey === normalized) continue;
      node.pause();
      node.currentTime = 0;
    }
    this.currentMusicKey = normalized;
    this.applyMusicVolume();
    if (this.unlocked) this.playCurrentMusic();
  }

  playCurrentMusic() {
    if (!this.currentMusicKey) return;
    const node = this.music[this.currentMusicKey];
    if (!node) return;
    node.volume = this.settings.muted ? 0 : this.settings.musicVolume;
    if (node.volume <= 0) return;
    const result = node.play();
    if (result?.catch) result.catch(() => {});
  }

  applyMusicVolume() {
    for (const node of Object.values(this.music)) {
      node.volume = this.settings.muted ? 0 : this.settings.musicVolume;
    }
  }

  setMuted(value) {
    this.settings.muted = Boolean(value);
    this.persist();
    this.applyMusicVolume();
    if (!this.settings.muted && this.unlocked) this.playCurrentMusic();
  }

  toggleMute() {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  setMusicVolume(value) {
    this.settings.musicVolume = clamp01(value);
    this.persist();
    this.applyMusicVolume();
    if (this.unlocked && !this.settings.muted) this.playCurrentMusic();
  }

  setSfxVolume(value) {
    this.settings.sfxVolume = clamp01(value);
    this.persist();
  }

  getPool(key, size = 6) {
    const src = SFX_TRACKS[key];
    if (!src) return [];
    const poolKey = `${key}:${size}`;
    if (!this.sfxPools.has(poolKey)) {
      const nodes = Array.from({ length: size }, () => {
        const node = new Audio(src);
        node.preload = 'auto';
        node.playsInline = true;
        return node;
      });
      this.sfxPools.set(poolKey, { nodes, cursor: 0 });
    }
    return this.sfxPools.get(poolKey);
  }


  // Patch 4: construct the hot gameplay pools while the loading screen is still
  // visible. This avoids first-use Audio element allocation during combat.
  prewarmGameplayPools() {
    if (this.safariTouch) {
      // Patch 7 — 15 nodes instead of 31. High-frequency combat sounds are
      // allowed to drop an overlapping voice rather than forcing Safari to
      // maintain a large set of MP3 decoder/media-element pipelines.
      this.getPool('laser', 3);
      this.getPool('enemyFire', 3);
      this.getPool('enemyDestroy', 3);
      this.getPool('explosion', 2);
      this.getPool('waveStart', 1);
      this.getPool('waveClear', 1);
      this.getPool('bombBlast', 2);
      return;
    }
    if (this.safariDesktop) {
      this.getPool('laser', 5);
      this.getPool('enemyFire', 4);
      this.getPool('enemyDestroy', 4);
      this.getPool('explosion', 3);
      this.getPool('waveStart', 1);
      this.getPool('waveClear', 1);
      this.getPool('bombBlast', 2);
      return;
    }
    this.getPool('laser', 8);
    this.getPool('enemyFire', 7);
    this.getPool('enemyDestroy', 6);
    this.getPool('explosion', 3);
    this.getPool('waveStart', 2);
    this.getPool('waveClear', 2);
    this.getPool('bombBlast', 3);
  }

  playSfx(key, options = {}) {
    if (this.settings.muted || this.settings.sfxVolume <= 0 || !SFX_TRACKS[key]) return false;
    const now = performance.now();
    const throttleMs = Math.max(0, Number(options.throttleMs || 0));
    const last = Number(this.lastSfxAt.get(key) || 0);
    if (throttleMs > 0 && now - last < throttleMs) return false;
    this.lastSfxAt.set(key, now);

    let requestedPoolSize = Math.max(1, Math.min(12, Number(options.poolSize || (key === 'laser' ? 8 : 4))));
    if (this.safariTouch) {
      const safariPoolCaps = { laser: 3, enemyFire: 3, enemyDestroy: 3, explosion: 2, chargeUp: 2, diveFlyby: 2, bombBlast: 2, waveStart: 1, waveClear: 1 };
      requestedPoolSize = Math.min(requestedPoolSize, Number(safariPoolCaps[key] || 2));
    } else if (this.safariDesktop) {
      const safariDesktopPoolCaps = { laser: 5, enemyFire: 4, enemyDestroy: 4, explosion: 3, chargeUp: 2, diveFlyby: 3, bombBlast: 2, waveStart: 1, waveClear: 1 };
      requestedPoolSize = Math.min(requestedPoolSize, Number(safariDesktopPoolCaps[key] || 3));
    }
    const pool = this.getPool(key, requestedPoolSize);
    if (!pool?.nodes?.length) return false;

    let node = pool.nodes[pool.cursor % pool.nodes.length];
    if (this.safariOptimized) {
      // Prefer an idle voice. If all voices are busy, drop this cosmetic sound
      // rather than pause/seek an active HTMLAudio element, which is a known
      // sustained-combat hotspot in WebKit.
      const idleIndex = pool.nodes.findIndex((candidate) => candidate.paused || candidate.ended);
      if (idleIndex < 0) return false;
      node = pool.nodes[idleIndex];
      pool.cursor = (idleIndex + 1) % pool.nodes.length;
    } else {
      pool.cursor = (pool.cursor + 1) % pool.nodes.length;
    }

    try {
      if (!node.paused) node.pause();
      node.currentTime = 0;
      node.playbackRate = Math.max(0.5, Math.min(2, Number(options.rate || 1)));
      node.volume = clamp01(this.settings.sfxVolume * clamp01(options.volume ?? 1));
      const result = node.play();
      if (result?.catch) result.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
}

export const audioManager = new AudioManager();
