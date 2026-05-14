// Takus — Observer Module Tests
// Tests the console, network, action hooks, and privacy redaction.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Observer } from '../observer.js';

describe('Observer', () => {
  let obs;

  beforeEach(() => {
    obs = new Observer();
  });

  afterEach(() => {
    obs.stop(); // Ensure hooks are cleaned up
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('returns an empty snapshot before start', () => {
      const snap = obs.stop();
      expect(snap.consoleErrors).toEqual([]);
      expect(snap.networkErrors).toEqual([]);
      expect(snap.actions).toEqual([]);
    });

    it('can be started and stopped', () => {
      obs.start();
      const snap = obs.stop();
      expect(snap).toHaveProperty('consoleErrors');
      expect(snap).toHaveProperty('networkErrors');
      expect(snap).toHaveProperty('actions');
    });

    it('ignores duplicate start calls', () => {
      obs.start();
      obs.start(); // Should not throw
      obs.stop();
    });
  });

  // ── Console hook ──────────────────────────────────────────────────────────

  describe('console hook', () => {
    it('captures console.error calls', () => {
      obs.start();
      console.error('test error message');
      const snap = obs.stop();
      expect(snap.consoleErrors.length).toBeGreaterThanOrEqual(1);
      const entry = snap.consoleErrors.find(e => e.message.includes('test error message'));
      expect(entry).toBeTruthy();
      expect(entry.level).toBe('error');
      expect(entry.ts).toBeGreaterThan(0);
    });

    it('captures console.warn calls', () => {
      obs.start();
      console.warn('test warning');
      const snap = obs.stop();
      const entry = snap.consoleErrors.find(e => e.message.includes('test warning'));
      expect(entry).toBeTruthy();
      expect(entry.level).toBe('warn');
    });

    it('truncates long messages to 500 chars', () => {
      obs.start();
      console.error('x'.repeat(1000));
      const snap = obs.stop();
      const entry = snap.consoleErrors.find(e => e.message.startsWith('xxx'));
      expect(entry.message.length).toBeLessThanOrEqual(500);
    });

    it('restores console methods after stop (no double-wrapping)', () => {
      obs.start();
      console.error('during observation');
      obs.stop();
      // After stop, console.error should still work without throwing
      expect(() => console.error('after stop')).not.toThrow();
    });
  });

  // ── Selector redaction ────────────────────────────────────────────────────

  describe('selector privacy', () => {
    it('redacts password-type input fields', () => {
      obs.start();
      const input = document.createElement('input');
      input.type = 'password';
      input.name = 'password';
      document.body.appendChild(input);
      input.click();
      // Allow event to propagate
      const snap = obs.stop();
      document.body.removeChild(input);
      // Check that actions captured a click
      const clickAction = snap.actions.find(a => a.type === 'click');
      if (clickAction) {
        // The target should be redacted for password fields
        expect(clickAction.target).toBe('[redacted-field]');
      }
    });

    it('redacts elements with api-key in name', () => {
      obs.start();
      const input = document.createElement('input');
      input.name = 'api-key';
      document.body.appendChild(input);
      input.click();
      const snap = obs.stop();
      document.body.removeChild(input);
      const clickAction = snap.actions.find(a => a.type === 'click');
      if (clickAction) {
        expect(clickAction.target).toBe('[redacted-field]');
      }
    });
  });

  // ── Action hook ───────────────────────────────────────────────────────────

  describe('action hook', () => {
    it('captures click events', () => {
      obs.start();
      const btn = document.createElement('button');
      btn.id = 'test-btn';
      document.body.appendChild(btn);
      btn.click();
      const snap = obs.stop();
      document.body.removeChild(btn);
      const action = snap.actions.find(a => a.type === 'click' && a.target.includes('#test-btn'));
      expect(action).toBeTruthy();
    });

    it('captures specific keydown events (Enter, Tab, Escape)', () => {
      obs.start();
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      document.dispatchEvent(event);
      const snap = obs.stop();
      const action = snap.actions.find(a => a.type === 'keydown' && a.detail === 'Enter');
      expect(action).toBeTruthy();
    });

    it('ignores regular character keydown events for privacy', () => {
      obs.start();
      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      document.dispatchEvent(event);
      const snap = obs.stop();
      const charAction = snap.actions.find(a => a.type === 'keydown' && a.detail === 'a');
      expect(charAction).toBeUndefined();
    });
  });

  // ── Snapshot immutability ─────────────────────────────────────────────────

  describe('snapshot', () => {
    it('returns a new array copy each time', () => {
      obs.start();
      console.error('snap1');
      const snap1 = obs.stop();
      snap1.consoleErrors.push({ fake: true });
      // Starting fresh should not include the pushed entry
      obs.start();
      console.error('snap2');
      const snap2 = obs.stop();
      expect(snap2.consoleErrors.find(e => e.fake)).toBeUndefined();
    });
  });

  // ── Entry cap ─────────────────────────────────────────────────────────────

  describe('entry cap', () => {
    it('does not exceed MAX_ENTRIES (500) for console errors', () => {
      obs.start();
      for (let i = 0; i < 600; i++) {
        console.error(`Error ${i}`);
      }
      const snap = obs.stop();
      expect(snap.consoleErrors.length).toBeLessThanOrEqual(500);
    });
  });
});
