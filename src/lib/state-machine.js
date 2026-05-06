// Takus — Recording State Machine

export const States = {
  IDLE:              'idle',
  REQUESTING_ACCESS: 'requesting_access',
  PREVIEWING:        'previewing',
  RECORDING:         'recording',
  PAUSED:            'paused',
  REVIEWING:         'reviewing',
  PROCESSING:        'processing',
  UPLOADING:         'uploading',
  COMPLETE:          'complete',
  UPLOAD_FAILED:     'upload_failed',
};

const TRANSITIONS = {
  [States.IDLE]:              ['requesting_access'],
  [States.REQUESTING_ACCESS]: ['previewing', 'idle'],
  [States.PREVIEWING]:        ['recording', 'idle'],
  [States.RECORDING]:         ['paused', 'reviewing', 'idle'],
  [States.PAUSED]:            ['recording', 'reviewing', 'idle'],
  [States.REVIEWING]:         ['processing', 'idle'],
  [States.PROCESSING]:        ['uploading', 'idle'],
  [States.UPLOADING]:         ['complete', 'upload_failed'],
  [States.COMPLETE]:          ['idle'],
  [States.UPLOAD_FAILED]:     ['uploading', 'idle'],
};

export class StateMachine {
  constructor() {
    this._state = States.IDLE;
    this._listeners = new Set();
    this._history = [{ state: States.IDLE, time: Date.now() }];
  }

  get state() { return this._state; }

  get history() { return [...this._history]; }

  canTransition(to) {
    const allowed = TRANSITIONS[this._state];
    return allowed && allowed.includes(to);
  }

  transition(to) {
    if (!this.canTransition(to)) {
      console.warn(`[StateMachine] Invalid transition: ${this._state} → ${to}`);
      return false;
    }
    const from = this._state;
    this._state = to;
    this._history.push({ state: to, time: Date.now() });
    // Cap history to prevent unbounded memory growth during long sessions
    if (this._history.length > 100) this._history = this._history.slice(-50);
    this._emit({ from, to });
    return true;
  }

  is(...states) { return states.includes(this._state); }

  onTransition(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  reset() {
    this._state = States.IDLE;
    this._history = [{ state: States.IDLE, time: Date.now() }];
    this._emit({ from: null, to: States.IDLE });
  }

  _emit(event) {
    for (const fn of this._listeners) {
      try { fn(event); } catch (e) { console.error('[StateMachine] Listener error:', e); }
    }
  }
}
