export const DIFFICULTY_ECONOMY = Object.freeze({
  easy: Object.freeze({
    startMultiplier: 1.50,
    comboWindow: 2.50,
    comboSteps: Object.freeze([1, 1.15, 1.30, 1.45, 1.60, 1.80, 2.00]),
    scoreGates: Object.freeze({ 3: 15300, 5: 35700, 7: 63750, 9: 97750, 10: 127500 }),
    checkpointMultipliers: Object.freeze({ 3: 1.80, 5: 2.20, 7: 2.70, 9: 3.30, 10: 4.00 })
  }),
  medium: Object.freeze({
    startMultiplier: 2.25,
    comboWindow: 1.80,
    comboSteps: Object.freeze([1, 1.20, 1.40, 1.60, 2.00, 2.50, 3.00]),
    scoreGates: Object.freeze({ 3: 18000, 5: 42000, 7: 75000, 9: 115000, 10: 150000 }),
    checkpointMultipliers: Object.freeze({ 3: 2.75, 5: 3.40, 7: 4.20, 9: 5.20, 10: 6.25 })
  }),
  hard: Object.freeze({
    startMultiplier: 4.00,
    comboWindow: 1.25,
    comboSteps: Object.freeze([1, 1.50, 2.00, 2.50, 3.00, 3.50, 4.00]),
    scoreGates: Object.freeze({ 3: 21600, 5: 50400, 7: 90000, 9: 138000, 10: 180000 }),
    checkpointMultipliers: Object.freeze({ 3: 4.80, 5: 5.80, 7: 7.00, 9: 8.50, 10: 10.00 })
  })
});

export function economyForDifficulty(difficulty = 'medium') {
  return DIFFICULTY_ECONOMY[String(difficulty || '').toLowerCase()] || DIFFICULTY_ECONOMY.medium;
}
export function comboStepsForDifficulty(difficulty = 'medium') { return economyForDifficulty(difficulty).comboSteps; }
export function comboWindowForDifficulty(difficulty = 'medium') { return economyForDifficulty(difficulty).comboWindow; }
export function startMultiplierForDifficulty(difficulty = 'medium') { return economyForDifficulty(difficulty).startMultiplier; }
export function scoreGateForDifficulty(wave, difficulty = 'medium') { return Number(economyForDifficulty(difficulty).scoreGates[Number(wave)] || 0); }
export function checkpointMultiplierForDifficulty(wave, difficulty = 'medium') { return Number(economyForDifficulty(difficulty).checkpointMultipliers[Number(wave)] || 0); }

// Medium aliases kept for older UI/debug code that imports the original constants directly.
export const COMBO_STEPS = DIFFICULTY_ECONOMY.medium.comboSteps;

export const SCORE_VALUES = Object.freeze({
  fighter: 100,
  diver: 150,
  shooter: 200,
  heavy: 300,
  charger: 300,
  elite: 500,
  miniBoss: 1000,
  finalBoss: 5000
});

export const SCORE_GATES = DIFFICULTY_ECONOMY.medium.scoreGates;
export const CHECKPOINT_MULTIPLIERS = DIFFICULTY_ECONOMY.medium.checkpointMultipliers;

const slot = (type, x, y, options = {}) => Object.freeze({
  type,
  x,
  y,
  group: options.group || '',
  lane: options.lane || '',
  order: Number.isFinite(options.order) ? options.order : 0
});

// Hand-authored combat formations. These replace the old generic grid generator so
// each enemy class occupies a position that communicates its gameplay role.
export const FORMATION_TEMPLATES = Object.freeze({
  1: Object.freeze([
    slot('shooter', 0.32, 0.14, { lane: 'back-left', order: 0 }),
    slot('shooter', 0.68, 0.14, { lane: 'back-right', order: 0 }),
    slot('fighter', 0.25, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.42, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.58, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.75, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.32, 0.31, { lane: 'line', order: 2 }),
    slot('fighter', 0.44, 0.31, { lane: 'line', order: 2 }),
    slot('fighter', 0.56, 0.31, { lane: 'line', order: 2 }),
    slot('fighter', 0.68, 0.31, { lane: 'line', order: 2 }),
    slot('diver', 0.14, 0.29, { lane: 'wing-left', order: 3 }),
    slot('diver', 0.86, 0.29, { lane: 'wing-right', order: 3 })
  ]),

  2: Object.freeze([
    slot('shooter', 0.25, 0.13, { lane: 'back-left', order: 0 }),
    slot('shooter', 0.50, 0.13, { lane: 'back-center', order: 0 }),
    slot('shooter', 0.75, 0.13, { lane: 'back-right', order: 0 }),
    slot('fighter', 0.26, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.38, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.50, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.62, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.74, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.35, 0.31, { lane: 'line', order: 2 }),
    slot('fighter', 0.50, 0.31, { lane: 'line', order: 2 }),
    slot('fighter', 0.65, 0.31, { lane: 'line', order: 2 }),
    slot('diver', 0.12, 0.25, { lane: 'wing-left', order: 3 }),
    slot('diver', 0.21, 0.34, { lane: 'wing-left', order: 3 }),
    slot('diver', 0.50, 0.42, { lane: 'center-dive', order: 4 }),
    slot('diver', 0.79, 0.34, { lane: 'wing-right', order: 3 }),
    slot('diver', 0.88, 0.25, { lane: 'wing-right', order: 3 })
  ]),

  3: Object.freeze([
    slot('shooter', 0.22, 0.13, { lane: 'back-left', order: 0 }),
    slot('shooter', 0.40, 0.13, { lane: 'back-left', order: 0 }),
    slot('shooter', 0.60, 0.13, { lane: 'back-right', order: 0 }),
    slot('shooter', 0.78, 0.13, { lane: 'back-right', order: 0 }),
    slot('fighter', 0.25, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.375, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.50, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.625, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.75, 0.22, { lane: 'line', order: 1 }),
    slot('fighter', 0.42, 0.31, { lane: 'line', order: 2 }),
    slot('fighter', 0.58, 0.31, { lane: 'line', order: 2 }),
    slot('diver', 0.12, 0.30, { lane: 'zig-left', order: 3 }),
    slot('diver', 0.22, 0.37, { lane: 'zig-left', order: 4 }),
    slot('diver', 0.30, 0.30, { lane: 'zig-left', order: 3 }),
    slot('diver', 0.50, 0.37, { lane: 'zig-center', order: 4 }),
    slot('diver', 0.70, 0.30, { lane: 'zig-right', order: 3 }),
    slot('diver', 0.78, 0.37, { lane: 'zig-right', order: 4 }),
    slot('diver', 0.88, 0.30, { lane: 'zig-right', order: 3 })
  ]),

  4: Object.freeze([
    slot('shooter', 0.15, 0.14, { lane: 'left-battery', order: 0 }),
    slot('shooter', 0.25, 0.14, { lane: 'left-battery', order: 0 }),
    slot('shooter', 0.35, 0.14, { lane: 'left-battery', order: 0 }),
    slot('shooter', 0.65, 0.14, { lane: 'right-battery', order: 0 }),
    slot('shooter', 0.75, 0.14, { lane: 'right-battery', order: 0 }),
    slot('shooter', 0.85, 0.14, { lane: 'right-battery', order: 0 }),
    slot('fighter', 0.25, 0.23, { lane: 'center-line', order: 1 }),
    slot('fighter', 0.35, 0.23, { lane: 'center-line', order: 1 }),
    slot('fighter', 0.45, 0.23, { lane: 'center-line', order: 1 }),
    slot('fighter', 0.55, 0.23, { lane: 'center-line', order: 1 }),
    slot('fighter', 0.65, 0.23, { lane: 'center-line', order: 1 }),
    slot('fighter', 0.75, 0.23, { lane: 'center-line', order: 1 }),
    slot('diver', 0.10, 0.32, { lane: 'pincer-left', order: 2 }),
    slot('diver', 0.18, 0.37, { lane: 'pincer-left', order: 3 }),
    slot('diver', 0.26, 0.32, { lane: 'pincer-left', order: 2 }),
    slot('diver', 0.34, 0.37, { lane: 'pincer-left', order: 3 }),
    slot('diver', 0.66, 0.37, { lane: 'pincer-right', order: 3 }),
    slot('diver', 0.74, 0.32, { lane: 'pincer-right', order: 2 }),
    slot('diver', 0.82, 0.37, { lane: 'pincer-right', order: 3 }),
    slot('diver', 0.90, 0.32, { lane: 'pincer-right', order: 2 })
  ]),

  // Gameplay Patch 3: Wave 5 is a dedicated solo encounter. The Mini Boss owns
  // the entire combat budget; no regular enemies can spawn beside it.
  5: Object.freeze([
    slot('miniBoss', 0.50, 0.16, { lane: 'boss', order: 0 })
  ]),

  6: Object.freeze([
    slot('heavy', 0.18, 0.14, { lane: 'anchor-left', order: 0 }),
    slot('heavy', 0.50, 0.14, { lane: 'anchor-center', order: 0 }),
    slot('heavy', 0.82, 0.14, { lane: 'anchor-right', order: 0 }),
    slot('shooter', 0.30, 0.19, { lane: 'back-left', order: 1 }),
    slot('shooter', 0.42, 0.19, { lane: 'back-left', order: 1 }),
    slot('shooter', 0.58, 0.19, { lane: 'back-right', order: 1 }),
    slot('shooter', 0.70, 0.19, { lane: 'back-right', order: 1 }),
    slot('fighter', 0.28, 0.28, { lane: 'line', order: 2 }),
    slot('fighter', 0.39, 0.28, { lane: 'line', order: 2 }),
    slot('fighter', 0.50, 0.28, { lane: 'line', order: 2 }),
    slot('fighter', 0.61, 0.28, { lane: 'line', order: 2 }),
    slot('fighter', 0.72, 0.28, { lane: 'line', order: 2 }),
    slot('diver', 0.18, 0.38, { lane: 'spiral-left', order: 3 }),
    slot('diver', 0.30, 0.38, { lane: 'spiral-left', order: 3 }),
    slot('diver', 0.42, 0.38, { lane: 'spiral-left', order: 4 }),
    slot('diver', 0.58, 0.38, { lane: 'spiral-right', order: 4 }),
    slot('diver', 0.70, 0.38, { lane: 'spiral-right', order: 3 }),
    slot('diver', 0.82, 0.38, { lane: 'spiral-right', order: 3 }),
    slot('charger', 0.08, 0.26, { lane: 'flank-left', order: 2 }),
    slot('charger', 0.92, 0.26, { lane: 'flank-right', order: 2 })
  ]),

  7: Object.freeze([
    slot('shooter', 0.12, 0.13, { lane: 'crossfire-left', order: 0 }),
    slot('shooter', 0.23, 0.13, { lane: 'crossfire-left', order: 0 }),
    slot('shooter', 0.34, 0.13, { lane: 'crossfire-left', order: 0 }),
    slot('shooter', 0.66, 0.13, { lane: 'crossfire-right', order: 0 }),
    slot('shooter', 0.77, 0.13, { lane: 'crossfire-right', order: 0 }),
    slot('shooter', 0.88, 0.13, { lane: 'crossfire-right', order: 0 }),
    slot('heavy', 0.18, 0.22, { lane: 'anchor-left', order: 1 }),
    slot('heavy', 0.50, 0.22, { lane: 'anchor-center', order: 1 }),
    slot('heavy', 0.82, 0.22, { lane: 'anchor-right', order: 1 }),
    slot('fighter', 0.34, 0.31, { lane: 'center-line', order: 2 }),
    slot('fighter', 0.45, 0.31, { lane: 'center-line', order: 2 }),
    slot('fighter', 0.55, 0.31, { lane: 'center-line', order: 2 }),
    slot('fighter', 0.66, 0.31, { lane: 'center-line', order: 2 }),
    slot('diver', 0.18, 0.40, { lane: 'dive-left', order: 3 }),
    slot('diver', 0.30, 0.40, { lane: 'dive-left', order: 3 }),
    slot('diver', 0.42, 0.40, { lane: 'dive-left', order: 4 }),
    slot('diver', 0.58, 0.40, { lane: 'dive-right', order: 4 }),
    slot('diver', 0.70, 0.40, { lane: 'dive-right', order: 3 }),
    slot('diver', 0.82, 0.40, { lane: 'dive-right', order: 3 }),
    slot('charger', 0.08, 0.47, { lane: 'flank-left', order: 5 }),
    slot('charger', 0.50, 0.47, { lane: 'flank-center', order: 5 }),
    slot('charger', 0.92, 0.47, { lane: 'flank-right', order: 5 })
  ]),

  8: Object.freeze([
    // Five readable swarm pods. Patch 2 will turn the group metadata into staged waves.
    slot('fighter', 0.13, 0.11, { group: 'A', lane: 'swarm', order: 0 }),
    slot('fighter', 0.15, 0.19, { group: 'A', lane: 'swarm', order: 0 }),
    slot('fighter', 0.13, 0.27, { group: 'A', lane: 'swarm', order: 0 }),
    slot('diver', 0.15, 0.35, { group: 'A', lane: 'swarm', order: 1 }),
    slot('shooter', 0.13, 0.43, { group: 'A', lane: 'swarm', order: 1 }),

    slot('fighter', 0.31, 0.13, { group: 'B', lane: 'swarm', order: 1 }),
    slot('fighter', 0.33, 0.21, { group: 'B', lane: 'swarm', order: 1 }),
    slot('diver', 0.31, 0.29, { group: 'B', lane: 'swarm', order: 2 }),
    slot('diver', 0.33, 0.37, { group: 'B', lane: 'swarm', order: 2 }),
    slot('shooter', 0.31, 0.45, { group: 'B', lane: 'swarm', order: 1 }),

    slot('fighter', 0.49, 0.11, { group: 'C', lane: 'swarm', order: 2 }),
    slot('fighter', 0.51, 0.19, { group: 'C', lane: 'swarm', order: 2 }),
    slot('diver', 0.49, 0.27, { group: 'C', lane: 'swarm', order: 3 }),
    slot('shooter', 0.51, 0.35, { group: 'C', lane: 'swarm', order: 2 }),
    slot('charger', 0.49, 0.43, { group: 'C', lane: 'swarm', order: 4 }),

    slot('fighter', 0.67, 0.13, { group: 'D', lane: 'swarm', order: 1 }),
    slot('fighter', 0.69, 0.21, { group: 'D', lane: 'swarm', order: 1 }),
    slot('diver', 0.67, 0.29, { group: 'D', lane: 'swarm', order: 2 }),
    slot('diver', 0.69, 0.37, { group: 'D', lane: 'swarm', order: 2 }),
    slot('shooter', 0.67, 0.45, { group: 'D', lane: 'swarm', order: 1 }),

    slot('fighter', 0.85, 0.11, { group: 'E', lane: 'swarm', order: 0 }),
    slot('fighter', 0.87, 0.19, { group: 'E', lane: 'swarm', order: 0 }),
    slot('fighter', 0.85, 0.27, { group: 'E', lane: 'swarm', order: 0 }),
    slot('diver', 0.87, 0.35, { group: 'E', lane: 'swarm', order: 1 }),
    slot('charger', 0.85, 0.43, { group: 'E', lane: 'swarm', order: 1 })
  ]),

  9: Object.freeze([
    slot('elite', 0.31, 0.11, { lane: 'command-left', order: 0 }),
    slot('elite', 0.50, 0.11, { lane: 'command-center', order: 0 }),
    slot('elite', 0.69, 0.11, { lane: 'command-right', order: 0 }),
    slot('heavy', 0.16, 0.20, { lane: 'anchor-left', order: 1 }),
    slot('heavy', 0.38, 0.20, { lane: 'anchor-left', order: 1 }),
    slot('heavy', 0.62, 0.20, { lane: 'anchor-right', order: 1 }),
    slot('heavy', 0.84, 0.20, { lane: 'anchor-right', order: 1 }),
    slot('shooter', 0.12, 0.29, { lane: 'battery-left', order: 2 }),
    slot('shooter', 0.32, 0.29, { lane: 'battery-left', order: 2 }),
    slot('shooter', 0.68, 0.29, { lane: 'battery-right', order: 2 }),
    slot('shooter', 0.88, 0.29, { lane: 'battery-right', order: 2 }),
    slot('fighter', 0.35, 0.36, { lane: 'screen', order: 3 }),
    slot('fighter', 0.45, 0.36, { lane: 'screen', order: 3 }),
    slot('fighter', 0.55, 0.36, { lane: 'screen', order: 3 }),
    slot('fighter', 0.65, 0.36, { lane: 'screen', order: 3 }),
    slot('diver', 0.22, 0.43, { lane: 'assault-left', order: 4 }),
    slot('diver', 0.40, 0.43, { lane: 'assault-left', order: 4 }),
    slot('diver', 0.60, 0.43, { lane: 'assault-right', order: 4 }),
    slot('diver', 0.78, 0.43, { lane: 'assault-right', order: 4 }),
    slot('charger', 0.10, 0.47, { lane: 'flank-left', order: 5 }),
    slot('charger', 0.50, 0.47, { lane: 'flank-center', order: 5 }),
    slot('charger', 0.90, 0.47, { lane: 'flank-right', order: 5 })
  ]),

  10: Object.freeze([
    slot('finalBoss', 0.50, 0.17, { lane: 'boss', order: 0 })
  ])
});

export const WAVES = Object.freeze({
  1: {
    id: 1, label: 'TRAINING FORMATION', enemyCount: 12, patternBudget: 3,
    mix: { fighter: 8, diver: 2, shooter: 2 }, formation: FORMATION_TEMPLATES[1],
    allowedPatterns: ['singleDive'], signaturePattern: 'singleDive', patternWeights: { singleDive: 1 }, fireTokens: 1, timeCap: 45
  },
  2: {
    id: 2, label: 'TWIN DIVE', enemyCount: 16, patternBudget: 5,
    mix: { fighter: 8, diver: 5, shooter: 3 }, formation: FORMATION_TEMPLATES[2],
    allowedPatterns: ['singleDive', 'twinDive'], signaturePattern: 'twinDive', patternWeights: { singleDive: 0.30, twinDive: 0.70 }, fireTokens: 1, timeCap: 45
  },
  3: {
    id: 3, label: 'ZIGZAG ASSAULT', enemyCount: 18, patternBudget: 7,
    mix: { fighter: 7, diver: 7, shooter: 4 }, formation: FORMATION_TEMPLATES[3],
    allowedPatterns: ['singleDive', 'twinDive', 'zigzag'], signaturePattern: 'zigzag', patternWeights: { singleDive: 0.15, twinDive: 0.30, zigzag: 0.55 }, fireTokens: 1,
    scoreGate: SCORE_GATES[3], multiplier: CHECKPOINT_MULTIPLIERS[3], timeCap: 45
  },
  4: {
    id: 4, label: 'PINCER PRESSURE', enemyCount: 20, patternBudget: 9,
    mix: { fighter: 6, diver: 8, shooter: 6 }, formation: FORMATION_TEMPLATES[4],
    allowedPatterns: ['singleDive', 'twinDive', 'zigzag', 'pincer'], signaturePattern: 'pincer', patternWeights: { singleDive: 0.10, twinDive: 0.20, zigzag: 0.15, pincer: 0.55 }, fireTokens: 2, timeCap: 45
  },
  5: {
    id: 5, label: 'MINI BOSS', enemyCount: 1, patternBudget: 1,
    mix: { miniBoss: 1 }, formation: FORMATION_TEMPLATES[5],
    allowedPatterns: [], signaturePattern: '', patternWeights: {}, fireTokens: 0, checkpoint: true,
    scoreGate: SCORE_GATES[5], multiplier: CHECKPOINT_MULTIPLIERS[5], timeCap: 45
  },
  6: {
    id: 6, label: 'SPIRAL ENTRY', enemyCount: 20, patternBudget: 11,
    mix: { fighter: 5, diver: 6, shooter: 4, heavy: 3, charger: 2 }, formation: FORMATION_TEMPLATES[6],
    allowedPatterns: ['spiral', 'singleDive', 'charge'], signaturePattern: 'spiral', patternWeights: { spiral: 0.58, singleDive: 0.15, charge: 0.27 }, fireTokens: 2, timeCap: 42
  },
  7: {
    id: 7, label: 'CROSSFIRE', enemyCount: 22, patternBudget: 13,
    mix: { fighter: 4, diver: 6, shooter: 6, heavy: 3, charger: 3 }, formation: FORMATION_TEMPLATES[7],
    allowedPatterns: ['crossfire', 'pincer', 'twinDive', 'charge'], signaturePattern: 'crossfire', patternWeights: { crossfire: 0.55, pincer: 0.15, twinDive: 0.15, charge: 0.15 }, fireTokens: 2,
    scoreGate: SCORE_GATES[7], multiplier: CHECKPOINT_MULTIPLIERS[7], timeCap: 42
  },
  8: {
    id: 8, label: 'SWARM', enemyCount: 25, patternBudget: 14,
    mix: { fighter: 12, diver: 7, shooter: 4, charger: 2 }, formation: FORMATION_TEMPLATES[8],
    allowedPatterns: ['swarm', 'zigzag', 'twinDive', 'charge'], signaturePattern: 'swarm', patternWeights: { swarm: 0.62, zigzag: 0.14, twinDive: 0.14, charge: 0.10 }, fireTokens: 2, timeCap: 40
  },
  9: {
    id: 9, label: 'ELITE ASSAULT', enemyCount: 22, patternBudget: 16,
    mix: { fighter: 4, diver: 4, shooter: 4, heavy: 4, charger: 3, elite: 3 }, formation: FORMATION_TEMPLATES[9],
    allowedPatterns: ['eliteAssault', 'crossfire', 'pincer', 'charge', 'spiral'], signaturePattern: 'eliteAssault', patternWeights: { eliteAssault: 0.50, crossfire: 0.15, pincer: 0.12, charge: 0.13, spiral: 0.10 }, fireTokens: 2,
    scoreGate: SCORE_GATES[9], multiplier: CHECKPOINT_MULTIPLIERS[9], timeCap: 40
  },
  10: {
    id: 10, label: 'FINAL BOSS', enemyCount: 1, patternBudget: 16,
    mix: { finalBoss: 1 }, formation: FORMATION_TEMPLATES[10], allowedPatterns: [], signaturePattern: '', patternWeights: {}, fireTokens: 0,
    final: true, scoreGate: SCORE_GATES[10], multiplier: CHECKPOINT_MULTIPLIERS[10], timeCap: 90
  }
});

export function waveDefinition(wave, difficulty = 'medium') {
  const base = WAVES[Number(wave)] || WAVES[1];
  const scoreGate = scoreGateForDifficulty(base.id, difficulty);
  const multiplier = checkpointMultiplierForDifficulty(base.id, difficulty);
  if (!scoreGate && !multiplier) return base;
  return { ...base, ...(scoreGate ? { scoreGate } : {}), ...(multiplier ? { multiplier } : {}) };
}

export function accuracyBonusRate(accuracy) {
  const value = Number(accuracy || 0);
  if (value >= 95) return 0.15;
  if (value >= 85) return 0.10;
  if (value >= 75) return 0.05;
  return 0;
}

export function performanceRating(score, targetScore) {
  const target = Math.max(1, Number(targetScore || 1));
  const ratio = Number(score || 0) / target;
  if (ratio >= 1.10) return 'S+';
  if (ratio >= 1.00) return 'S';
  if (ratio >= 0.90) return 'A';
  if (ratio >= 0.75) return 'B';
  return 'C';
}
