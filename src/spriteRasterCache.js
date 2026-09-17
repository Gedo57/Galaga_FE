// Safari presentation cache. Only prepare() allocates canvases; lookup() is
// read-only and safe in the draw loop. One engine owns a bounded working set.
export class SpriteRasterCache {
  constructor({ maxBytes = 8 * 1024 * 1024, maxSide = 512, maxSurfaces = 64 } = {}) {
    this.maxBytes = maxBytes;
    this.maxSide = maxSide;
    this.maxSurfaces = maxSurfaces;
    this.entries = new Map();
    this.bytes = 0;
    this.surfaceCount = 0;
  }

  prepare(image, size, halfTurn = false) {
    if (!image || !image.complete || !(image.naturalWidth > 0)) return;
    const side = Math.max(1, Math.min(this.maxSide, Math.round(size) || 1));
    let variants = this.entries.get(image);
    if (variants?.some((entry) => entry.side === side)) return;
    const bytes = side * side * 4;
    if (this.bytes + bytes > this.maxBytes || this.surfaceCount >= this.maxSurfaces) return;
    const upright = this.makeSurface(image, side, false);
    if (!upright) return;
    const entry = { side, upright, halfTurn: null };
    if (!variants) { variants = []; this.entries.set(image, variants); }
    variants.push(entry);
    this.bytes += bytes;
    this.surfaceCount += 1;
    if (halfTurn && this.bytes + bytes <= this.maxBytes && this.surfaceCount < this.maxSurfaces) {
      entry.halfTurn = this.makeSurface(upright, side, true);
      if (entry.halfTurn) { this.bytes += bytes; this.surfaceCount += 1; }
    }
  }

  makeSurface(source, side, halfTurn) {
    let surface;
    try {
      surface = document.createElement('canvas');
      surface.width = side;
      surface.height = side;
      const ctx = surface.getContext('2d', { alpha: true });
      if (!ctx) { surface.width = surface.height = 0; return null; }
      if (halfTurn) { ctx.translate(side, side); ctx.rotate(Math.PI); }
      // Existing drawSprite intentionally fits every asset to a square. Keep
      // that mapping, including transparent padding and non-square sources.
      ctx.drawImage(source, 0, 0, side, side);
      return surface;
    } catch {
      if (surface) surface.width = surface.height = 0;
      return null;
    }
  }

  lookup(image, size) {
    const variants = this.entries.get(image);
    if (!variants) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const entry of variants) {
      // Keep unusual large effects sharp by falling back to their original.
      if (size > entry.side * 2) continue;
      const distance = Math.abs(entry.side - size);
      if (distance < bestDistance) { best = entry; bestDistance = distance; }
    }
    return best;
  }

  clear() {
    for (const variants of this.entries.values()) {
      for (const entry of variants) {
        entry.upright.width = entry.upright.height = 0;
        if (entry.halfTurn) entry.halfTurn.width = entry.halfTurn.height = 0;
      }
    }
    this.entries.clear();
    this.bytes = 0;
    this.surfaceCount = 0;
  }
}
