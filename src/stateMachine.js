export const GameState = Object.freeze({
  MENU: 'MENU',
  ENTRY_SELECTED: 'ENTRY_SELECTED',
  ENTRY_PAID: 'ENTRY_PAID',
  COUNTDOWN: 'COUNTDOWN',
  WAVE_PLAYING: 'WAVE_PLAYING',
  WAVE_CLEAR: 'WAVE_CLEAR',
  CHECKPOINT: 'CHECKPOINT',
  RESULT: 'RESULT',
  RUN_LOST: 'RUN_LOST',
  BOSS_COMPLETE: 'BOSS_COMPLETE'
});

const allowedTransitions = {
  [GameState.MENU]: [GameState.ENTRY_SELECTED, GameState.WAVE_PLAYING],
  [GameState.ENTRY_SELECTED]: [GameState.MENU, GameState.ENTRY_PAID],
  [GameState.ENTRY_PAID]: [GameState.COUNTDOWN, GameState.MENU],
  [GameState.COUNTDOWN]: [GameState.WAVE_PLAYING, GameState.MENU],
  [GameState.WAVE_PLAYING]: [GameState.WAVE_CLEAR, GameState.CHECKPOINT, GameState.RUN_LOST, GameState.RESULT, GameState.BOSS_COMPLETE, GameState.MENU],
  [GameState.WAVE_CLEAR]: [GameState.WAVE_PLAYING, GameState.RUN_LOST, GameState.MENU],
  [GameState.CHECKPOINT]: [GameState.WAVE_PLAYING, GameState.RESULT, GameState.RUN_LOST, GameState.MENU],
  [GameState.RESULT]: [GameState.MENU],
  [GameState.RUN_LOST]: [GameState.MENU],
  [GameState.BOSS_COMPLETE]: [GameState.RESULT, GameState.MENU]
};

export class StateMachine {
  constructor(initial = GameState.MENU) {
    this.state = initial;
    this.listeners = new Set();
  }
  can(next) { return next === this.state || (allowedTransitions[this.state] || []).includes(next); }
  set(next, { force = false } = {}) {
    if (!force && !this.can(next)) throw new Error(`Invalid state transition: ${this.state} -> ${next}`);
    this.state = next;
    this.listeners.forEach((listener) => listener(next));
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
