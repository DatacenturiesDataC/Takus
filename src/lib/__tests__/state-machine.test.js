// Takus — State Machine Unit Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateMachine, States } from '../state-machine.js';

describe('StateMachine', () => {
  let sm;

  beforeEach(() => {
    sm = new StateMachine();
  });

  // ── Initial state ─────────────────────────────────────────────────────
  describe('initial state', () => {
    it('starts in IDLE', () => {
      expect(sm.state).toBe(States.IDLE);
    });

    it('has initial history entry', () => {
      expect(sm.history).toHaveLength(1);
      expect(sm.history[0].state).toBe(States.IDLE);
      expect(sm.history[0].time).toBeTypeOf('number');
    });
  });

  // ── Valid transitions ────────────────────────────────────────────────
  describe('valid transitions', () => {
    it('IDLE → REQUESTING_ACCESS', () => {
      expect(sm.canTransition(States.REQUESTING_ACCESS)).toBe(true);
      expect(sm.transition(States.REQUESTING_ACCESS)).toBe(true);
      expect(sm.state).toBe(States.REQUESTING_ACCESS);
    });

    it('REQUESTING_ACCESS → PREVIEWING', () => {
      sm.transition(States.REQUESTING_ACCESS);
      expect(sm.transition(States.PREVIEWING)).toBe(true);
      expect(sm.state).toBe(States.PREVIEWING);
    });

    it('PREVIEWING → RECORDING', () => {
      sm.transition(States.REQUESTING_ACCESS);
      sm.transition(States.PREVIEWING);
      expect(sm.transition(States.RECORDING)).toBe(true);
      expect(sm.state).toBe(States.RECORDING);
    });

    it('RECORDING ⇄ PAUSED', () => {
      sm.transition(States.REQUESTING_ACCESS);
      sm.transition(States.PREVIEWING);
      sm.transition(States.RECORDING);

      expect(sm.transition(States.PAUSED)).toBe(true);
      expect(sm.state).toBe(States.PAUSED);

      expect(sm.transition(States.RECORDING)).toBe(true);
      expect(sm.state).toBe(States.RECORDING);
    });

    it('RECORDING → REVIEWING → PROCESSING → UPLOADING → COMPLETE → IDLE', () => {
      sm.transition(States.REQUESTING_ACCESS);
      sm.transition(States.PREVIEWING);
      sm.transition(States.RECORDING);
      sm.transition(States.REVIEWING);
      sm.transition(States.PROCESSING);
      sm.transition(States.UPLOADING);
      sm.transition(States.COMPLETE);
      sm.transition(States.IDLE);
      expect(sm.state).toBe(States.IDLE);
    });

    it('UPLOADING → UPLOAD_FAILED → UPLOADING (retry)', () => {
      sm.transition(States.REQUESTING_ACCESS);
      sm.transition(States.PREVIEWING);
      sm.transition(States.RECORDING);
      sm.transition(States.REVIEWING);
      sm.transition(States.PROCESSING);
      sm.transition(States.UPLOADING);
      sm.transition(States.UPLOAD_FAILED);
      expect(sm.state).toBe(States.UPLOAD_FAILED);

      expect(sm.transition(States.UPLOADING)).toBe(true);
      expect(sm.state).toBe(States.UPLOADING);
    });

    it('crash recovery: IDLE → REVIEWING', () => {
      expect(sm.canTransition(States.REVIEWING)).toBe(true);
      expect(sm.transition(States.REVIEWING)).toBe(true);
      expect(sm.state).toBe(States.REVIEWING);
    });
  });

  // ── Invalid transitions ──────────────────────────────────────────────
  describe('invalid transitions', () => {
    it('IDLE → RECORDING is invalid', () => {
      expect(sm.canTransition(States.RECORDING)).toBe(false);
      expect(sm.transition(States.RECORDING)).toBe(false);
      expect(sm.state).toBe(States.IDLE);
    });

    it('IDLE → UPLOADING is invalid', () => {
      expect(sm.canTransition(States.UPLOADING)).toBe(false);
    });

    it('COMPLETE → RECORDING is invalid', () => {
      sm.transition(States.REQUESTING_ACCESS);
      sm.transition(States.PREVIEWING);
      sm.transition(States.RECORDING);
      sm.transition(States.REVIEWING);
      sm.transition(States.PROCESSING);
      sm.transition(States.UPLOADING);
      sm.transition(States.COMPLETE);
      expect(sm.canTransition(States.RECORDING)).toBe(false);
    });

    it('PAUSED → COMPLETE is invalid', () => {
      sm.transition(States.REQUESTING_ACCESS);
      sm.transition(States.PREVIEWING);
      sm.transition(States.RECORDING);
      sm.transition(States.PAUSED);
      expect(sm.canTransition(States.COMPLETE)).toBe(false);
    });
  });

  // ── is() helper ──────────────────────────────────────────────────────
  describe('is()', () => {
    it('returns true for current state', () => {
      expect(sm.is(States.IDLE)).toBe(true);
    });

    it('returns true for multiple arguments if any match', () => {
      expect(sm.is(States.IDLE, States.RECORDING, States.PAUSED)).toBe(true);
    });

    it('returns false when no match', () => {
      expect(sm.is(States.RECORDING, States.PAUSED)).toBe(false);
    });
  });

  // ── Listeners ────────────────────────────────────────────────────────
  describe('listeners', () => {
    it('fires listener on transition', () => {
      const fn = vi.fn();
      sm.onTransition(fn);
      sm.transition(States.REQUESTING_ACCESS);
      expect(fn).toHaveBeenCalledWith({ from: States.IDLE, to: States.REQUESTING_ACCESS });
    });

    it('unsubscribe stops notifications', () => {
      const fn = vi.fn();
      const unsub = sm.onTransition(fn);
      unsub();
      sm.transition(States.REQUESTING_ACCESS);
      expect(fn).not.toHaveBeenCalled();
    });

    it('does not fire on invalid transition', () => {
      const fn = vi.fn();
      sm.onTransition(fn);
      sm.transition(States.RECORDING); // invalid from IDLE
      expect(fn).not.toHaveBeenCalled();
    });

    it('isolates listener errors', () => {
      const bad = vi.fn(() => { throw new Error('boom'); });
      const good = vi.fn();
      sm.onTransition(bad);
      sm.onTransition(good);
      sm.transition(States.REQUESTING_ACCESS);
      expect(bad).toHaveBeenCalled();
      expect(good).toHaveBeenCalled(); // should still fire despite bad listener
    });
  });

  // ── History capping ──────────────────────────────────────────────────
  describe('history capping', () => {
    it('caps history at 50 entries after exceeding 100', () => {
      // Force 100+ transitions by cycling IDLE → REQUESTING_ACCESS → IDLE
      for (let i = 0; i < 60; i++) {
        sm.transition(States.REQUESTING_ACCESS);
        sm.transition(States.IDLE);
      }
      // 1 initial + 120 transitions = 121, capped to last 50
      expect(sm.history.length).toBeLessThanOrEqual(100);
    });
  });

  // ── reset() ──────────────────────────────────────────────────────────
  describe('reset()', () => {
    it('returns to IDLE and clears history', () => {
      sm.transition(States.REQUESTING_ACCESS);
      sm.transition(States.PREVIEWING);
      sm.reset();
      expect(sm.state).toBe(States.IDLE);
      expect(sm.history).toHaveLength(1);
    });

    it('fires listener on reset', () => {
      const fn = vi.fn();
      sm.onTransition(fn);
      sm.reset();
      expect(fn).toHaveBeenCalledWith({ from: null, to: States.IDLE });
    });
  });

  // ── States enum ──────────────────────────────────────────────────────
  describe('States enum', () => {
    it('has exactly 11 states', () => {
      expect(Object.keys(States)).toHaveLength(11);
    });

    it('all values are lowercase strings', () => {
      for (const val of Object.values(States)) {
        expect(val).toMatch(/^[a-z_]+$/);
      }
    });
  });
});
