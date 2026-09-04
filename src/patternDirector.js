const PATTERNS = Object.freeze({
  singleDive: { id: 'singleDive', label: 'DIVE', cost: 1, minEnemies: 1 },
  twinDive: { id: 'twinDive', label: 'TWIN DIVE', cost: 1, minEnemies: 2 },
  zigzag: { id: 'zigzag', label: 'ZIGZAG', cost: 2, minEnemies: 1 },
  pincer: { id: 'pincer', label: 'PINCER', cost: 2, minEnemies: 2 },
  swarm: { id: 'swarm', label: 'SWARM', cost: 2, minEnemies: 3 },
  crossfire: { id: 'crossfire', label: 'CROSSFIRE', cost: 3, minEnemies: 2 },
  spiral: { id: 'spiral', label: 'SPIRAL', cost: 3, minEnemies: 2 },
  charge: { id: 'charge', label: 'CHARGE', cost: 4, minEnemies: 1 },
  eliteAssault: { id: 'eliteAssault', label: 'ELITE ASSAULT', cost: 4, minEnemies: 1 }
});

const DIFFICULTY_POOLS = Object.freeze({
  easy: ['singleDive', 'twinDive', 'zigzag', 'pincer', 'swarm', 'crossfire', 'spiral', 'charge', 'eliteAssault'],
  medium: ['singleDive', 'twinDive', 'zigzag', 'pincer', 'swarm', 'crossfire', 'spiral', 'charge', 'eliteAssault'],
  hard: ['singleDive', 'twinDive', 'zigzag', 'pincer', 'swarm', 'crossfire', 'spiral', 'charge', 'eliteAssault']
});

function weightedPick(items, getWeight, random) {
  const weighted = items
    .map((item) => ({ item, weight: Math.max(0, Number(getWeight(item) || 0)) }))
    .filter((entry) => entry.weight > 0);
  if (!weighted.length) return items[Math.floor(random() * items.length)];
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) return entry.item;
  }
  return weighted[weighted.length - 1].item;
}

export class PatternDirector {
  constructor({ difficulty = 'medium', random = Math.random, budget = 3, allowedPatterns = null, patternWeights = null, signaturePattern = '' } = {}) {
    this.difficulty = difficulty;
    this.random = random;
    this.budget = Math.max(1, Number(budget || 3));
    this.allowedPatterns = Array.isArray(allowedPatterns) && allowedPatterns.length ? new Set(allowedPatterns) : null;
    this.patternWeights = patternWeights && typeof patternWeights === 'object' ? { ...patternWeights } : {};
    this.signaturePattern = String(signaturePattern || '');
    this.cooldown = 2.6;
    this.lastPattern = '';
    this.samePatternStreak = 0;
    this.activations = Object.fromEntries(Object.keys(PATTERNS).map((id) => [id, 0]));
  }

  update(dt, engine) {
    this.cooldown -= dt;
    if (this.cooldown > 0 || Number(engine.recoveryTimer || 0) > 0 || engine.hasActiveAttackers() || engine.waveClearPending || engine.isBossWave?.()) return;

    const alive = engine.getAliveEnemies().filter((enemy) => !['miniBoss', 'finalBoss'].includes(enemy.type));
    if (alive.length < 1) return;

    const pool = DIFFICULTY_POOLS[this.difficulty] || DIFFICULTY_POOLS.medium;
    const valid = pool
      .filter((id) => !this.allowedPatterns || this.allowedPatterns.has(id))
      .map((id) => PATTERNS[id])
      .filter((pattern) => pattern.cost <= this.budget && alive.length >= pattern.minEnemies)
      .filter((pattern) => engine.canStartPattern(pattern.id));

    if (!valid.length) {
      this.cooldown = 0.65;
      return;
    }

    const pressure = Math.max(0, Math.min(1, Number(engine.getWavePressure?.() || 0)));
    let choices = valid;
    // Avoid three identical attacks in a row, but do not suppress a wave's signature move.
    if (this.samePatternStreak >= 2 && valid.some((pattern) => pattern.id !== this.lastPattern)) {
      choices = valid.filter((pattern) => pattern.id !== this.lastPattern);
    }

    const selected = weightedPick(choices, (pattern) => {
      let weight = Number(this.patternWeights[pattern.id] ?? 1);
      if (pattern.id === this.signaturePattern) weight *= 1.18 + pressure * 0.28;
      if (pattern.id === this.lastPattern) weight *= 0.62;
      // Patch 7: every difficulty now starts aggressive. Easy is Medium+,
      // Medium is Hard, and Hard strongly favors coordinated high-cost patterns.
      if (this.difficulty === 'easy') {
        if (pattern.cost >= 4) weight *= 0.95;
        else if (pattern.cost >= 3) weight *= 1.08;
        else if (pattern.cost === 1) weight *= 0.94;
      } else if (this.difficulty === 'medium') {
        if (pattern.cost >= 4) weight *= 1.35;
        else if (pattern.cost >= 3) weight *= 1.22;
        else if (pattern.cost === 1) weight *= 0.84;
      } else if (this.difficulty === 'hard') {
        if (pattern.cost >= 4) weight *= 1.75;
        else if (pattern.cost >= 3) weight *= 1.50;
        else if (pattern.cost === 1) weight *= 0.68;
      }
      if (pressure > 0.72 && pattern.cost === 1) {
        weight *= this.difficulty === 'hard' ? 0.60 : this.difficulty === 'medium' ? 0.76 : 0.92;
      }
      return weight;
    }, this.random);
    if (!selected) return;

    const started = engine.startPattern(selected.id);
    if (started) {
      this.samePatternStreak = selected.id === this.lastPattern ? this.samePatternStreak + 1 : 1;
      this.lastPattern = selected.id;
      this.activations[selected.id] += 1;
      engine.onPatternActivated(selected, this.activations);
    }

    const base = this.difficulty === 'hard' ? 1.55 : this.difficulty === 'medium' ? 2.10 : 2.90;
    const lateWaveFactor = 1 - pressure * 0.34;
    const enrageFactor = engine.enraged ? 0.74 : 1;
    this.cooldown = Math.max(this.difficulty === 'hard' ? 0.70 : this.difficulty === 'medium' ? 0.82 : 0.95, (base + this.random() * 0.72) * lateWaveFactor * enrageFactor);
  }

  snapshot() {
    return { lastPattern: this.lastPattern, patternActivations: { ...this.activations } };
  }
}

export { PATTERNS };
