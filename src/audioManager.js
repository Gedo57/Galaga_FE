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

// One fixed pool per sound. Event-specific poolSize is only a voice limit;
// it must never produce another set of media elements during combat.
const POOL_SIZES = Object.freeze({
  touch: Object.freeze({ laser: 3, enemyFire: 3, enemyDestroy: 3, explosion: 2, waveStart: 1, waveClear: 1, bombBlast: 2, chargeUp: 2, diveFlyby: 2, coinSpend: 2 }),
  safariDesktop: Object.freeze({ laser: 5, enemyFire: 4, enemyDestroy: 4, explosion: 3, waveStart: 1, waveClear: 1, bombBlast: 2, chargeUp: 2, diveFlyby: 3, coinSpend: 2 }),
  other: Object.freeze({ laser: 8, enemyFire: 7, enemyDestroy: 6, explosion: 3, waveStart: 2, waveClear: 2, bombBlast: 3, chargeUp: 2, diveFlyby: 4, coinSpend: 2 })
});
const IMPORTANT_SFX = new Set(['explosion', 'bombBlast', 'chargeUp', 'waveStart', 'waveClear', 'coinSpend']);
const SFX_READY_TIMEOUT_MS = 1500;

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
    // Select pool sizes once. Safari also gets a total playback voice budget
    // so combat cannot activate every preloaded media element simultaneously.
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
    this.poolSizes = this.safariTouch ? POOL_SIZES.touch : this.safariDesktop ? POOL_SIZES.safariDesktop : POOL_SIZES.other;
    this.voiceLimit = this.safariTouch ? 8 : this.safariDesktop ? 12 : Infinity;
    this.activeVoices = 0;
    this.prewarmPromise = null;
    this.applyMusicVolume();
  }

  snapshot() {
    return { ...this.settings };
  }

  persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch {}
  }

  unlock() {
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
    if (this.settings.muted || this.settings.musicVolume <= 0) { node.pause(); return; }
    if (!node.paused) return;
    try {
      const result = node.play();
      if (result?.catch) result.catch(() => {});
    } catch {}
  }

  applyMusicVolume() {
    for (const node of Object.values(this.music)) {
      node.volume = this.settings.muted ? 0 : this.settings.musicVolume;
      if (this.settings.muted || this.settings.musicVolume <= 0) node.pause();
    }
  }

  setMuted(value) {
    this.settings.muted = Boolean(value);
    this.persist();
    this.applyMusicVolume();
    this.applySfxVolume();
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
    this.applySfxVolume();
  }

  releaseVoice(voice) {
    voice.token += 1;
    if (!voice.busy) return;
    voice.busy = false;
    this.activeVoices = Math.max(0, this.activeVoices - 1);
  }

  applySfxVolume() {
    for (const pool of this.sfxPools.values()) {
      for (const voice of pool.voices) {
        voice.node.volume = this.settings.muted ? 0 : clamp01(this.settings.sfxVolume * voice.gain);
        if (this.settings.muted || this.settings.sfxVolume <= 0) {
          voice.node.pause();
          this.releaseVoice(voice);
        }
      }
    }
  }

  getPool(key) {
    // Read-only, including on cache misses. Allocation belongs to startup.
    return this.sfxPools.get(key) || null;
  }

  prewarmGameplayPools() {
    if (this.prewarmPromise) return this.prewarmPromise;
    const nodes = [];
    for (const [key, src] of Object.entries(SFX_TRACKS)) {
      const voices = [];
      for (let i = 0; i < this.poolSizes[key]; i += 1) {
        const node = new Audio(src);
        node.preload = 'auto';
        node.playsInline = true;
        const voice = { node, busy: false, token: 0, gain: 1 };
        node.addEventListener('ended', () => { if (node.ended) this.releaseVoice(voice); });
        node.addEventListener('pause', () => { if (node.paused) this.releaseVoice(voice); });
        node.addEventListener('error', () => this.releaseVoice(voice));
        voices.push(voice);
        nodes.push(node);
      }
      this.sfxPools.set(key, { voices, cursor: 0 });
    }
    this.applySfxVolume();
    // iOS can defer media loading until a gesture. Wait only a bounded time;
    // unfinished voices become eligible naturally once readyState advances.
    this.prewarmPromise = new Promise((resolve) => {
      let remaining = nodes.length;
      let ready = 0;
      let finished = false;
      const cleanups = [];
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        for (const cleanup of cleanups) cleanup();
        resolve({ total: nodes.length, ready, unavailable: nodes.length - ready });
      };
      const timer = window.setTimeout(finish, SFX_READY_TIMEOUT_MS);
      for (const node of nodes) {
        let settled = false;
        const cleanup = () => {
          node.removeEventListener('loadeddata', onReady);
          node.removeEventListener('canplay', onReady);
          node.removeEventListener('error', onError);
        };
        const settle = (ok) => {
          if (settled || finished) return;
          settled = true;
          if (ok) ready += 1;
          remaining -= 1;
          cleanup();
          if (!remaining) finish();
        };
        const onReady = () => { if (node.readyState >= 2) settle(true); };
        const onError = () => settle(false);
        cleanups.push(cleanup);
        node.addEventListener('loadeddata', onReady);
        node.addEventListener('canplay', onReady);
        node.addEventListener('error', onError);
        if (node.error) settle(false);
        else if (node.readyState >= 2) settle(true);
        else {
          try { node.load(); } catch { settle(false); }
          onReady();
        }
      }
      if (!remaining) finish();
    });
    return this.prewarmPromise;
  }

  playSfx(key, options = {}) {
    if (!this.unlocked || this.settings.muted || this.settings.sfxVolume <= 0) return false;
    const pool = this.getPool(key);
    if (!pool?.voices.length) return false;
    const now = performance.now();
    const throttleMs = Math.max(0, Number(options.throttleMs || 0));
    const last = this.lastSfxAt.get(key);
    if (last !== undefined && throttleMs > 0 && now - last < throttleMs) return false;
    const important = IMPORTANT_SFX.has(key) || options.priority === 'important';
    if (this.safariOptimized && this.activeVoices >= this.voiceLimit - (important ? 0 : 2)) return false;

    const requested = Number(options.poolSize || pool.voices.length);
    const limit = Math.max(1, Math.min(pool.voices.length, Math.floor(requested) || 1));
    let voice = null;
    let index = 0;
    for (let offset = 0; offset < limit; offset += 1) {
      index = (pool.cursor + offset) % limit;
      const candidate = pool.voices[index];
      if (!candidate.busy && (candidate.node.paused || candidate.node.ended) && candidate.node.readyState >= 2 && !candidate.node.error) {
        voice = candidate;
        break;
      }
    }
    // Safari drops an overlapping cosmetic voice instead of seeking a busy
    // media element. Other browsers retain their bounded round-robin behavior.
    if (!voice && !this.safariOptimized) {
      index = pool.cursor % limit;
      const candidate = pool.voices[index];
      if (candidate.node.readyState >= 2 && !candidate.node.error) {
        candidate.node.pause();
        this.releaseVoice(candidate);
        voice = candidate;
      }
    }
    if (!voice) return false;
    pool.cursor = (index + 1) % limit;
    const node = voice.node;
    const token = ++voice.token;
    voice.busy = true; // Reserve before play() resolves; paused may still be true.
    this.activeVoices += 1;
    voice.gain = clamp01(options.volume ?? 1);
    const failed = () => { if (voice.token === token) this.releaseVoice(voice); };
    try {
      if (node.currentTime !== 0) node.currentTime = 0;
      const rate = Math.max(0.5, Math.min(2, Number(options.rate || 1)));
      if (node.playbackRate !== rate) node.playbackRate = rate;
      node.volume = clamp01(this.settings.sfxVolume * voice.gain);
      const result = node.play();
      if (result?.catch) result.catch(failed);
      this.lastSfxAt.set(key, now);
      return true;
    } catch {
      failed();
      return false;
    }
  }
}

export const audioManager = new AudioManager();
