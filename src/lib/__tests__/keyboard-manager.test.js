// Tests for keyboard-manager.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock icons module
vi.mock('../../lib/icons.js', () => ({
  icons: new Proxy({}, { get: () => (size) => `<svg size="${size}"/>` }),
}));

import { openShortcutsOverlay, setupKeyboardShortcuts } from '../../lib/keyboard-manager.js';

describe('keyboard-manager', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.getElementById('shortcuts-overlay')?.remove();
  });

  describe('openShortcutsOverlay', () => {
    it('creates an overlay element in the DOM', () => {
      openShortcutsOverlay({ record: 'r', pause: ' ', stop: 's' });
      const overlay = document.getElementById('shortcuts-overlay');
      expect(overlay).toBeTruthy();
      expect(overlay.getAttribute('role')).toBe('dialog');
      expect(overlay.getAttribute('aria-modal')).toBe('true');
    });

    it('shows correct shortcut keys', () => {
      openShortcutsOverlay({ record: 'r', pause: ' ', stop: 's' });
      const overlay = document.getElementById('shortcuts-overlay');
      expect(overlay.innerHTML).toContain('R');
      expect(overlay.innerHTML).toContain('Space');
      expect(overlay.innerHTML).toContain('S');
    });

    it('removes existing overlay before creating a new one', () => {
      openShortcutsOverlay({ record: 'r', pause: ' ', stop: 's' });
      openShortcutsOverlay({ record: 'x', pause: ' ', stop: 'q' });
      const overlays = document.querySelectorAll('#shortcuts-overlay');
      expect(overlays.length).toBe(1);
      expect(overlays[0].innerHTML).toContain('X');
    });

    it('closes on close button click', () => {
      openShortcutsOverlay({ record: 'r', pause: ' ', stop: 's' });
      document.getElementById('sc-close').click();
      expect(document.getElementById('shortcuts-overlay')).toBeNull();
    });
  });

  describe('setupKeyboardShortcuts', () => {
    it('calls onStart when record key is pressed in IDLE state', () => {
      // JSDOM's document.hasFocus() always returns false — mock it for this test
      const origHasFocus = document.hasFocus;
      document.hasFocus = () => true;

      const onStart = vi.fn();
      const sm = { is: (...states) => states.includes('IDLE') };
      setupKeyboardShortcuts({
        sm,
        States: { IDLE: 'IDLE', RECORDING: 'RECORDING', PAUSED: 'PAUSED', PREVIEWING: 'PREVIEWING', REQUESTING_ACCESS: 'REQUESTING_ACCESS' },
        getShortcuts: () => ({ record: 'r', pause: ' ', stop: 's' }),
        focusAskInput: vi.fn(),
        openSettings: vi.fn(),
        onStart,
        onPause: vi.fn(),
        onResume: vi.fn(),
        onStop: vi.fn(),
      });

      const event = new KeyboardEvent('keydown', { key: 'r', bubbles: true });
      document.dispatchEvent(event);
      expect(onStart).toHaveBeenCalledTimes(1);

      document.hasFocus = origHasFocus;
    });

    it('does not fire shortcuts when typing in an input', () => {
      const onStart = vi.fn();
      const sm = { is: (...states) => states.includes('IDLE') };
      setupKeyboardShortcuts({
        sm,
        States: { IDLE: 'IDLE', RECORDING: 'RECORDING', PAUSED: 'PAUSED', PREVIEWING: 'PREVIEWING', REQUESTING_ACCESS: 'REQUESTING_ACCESS' },
        getShortcuts: () => ({ record: 'r', pause: ' ', stop: 's' }),
        focusAskInput: vi.fn(),
        openSettings: vi.fn(),
        onStart,
        onPause: vi.fn(),
        onResume: vi.fn(),
        onStop: vi.fn(),
      });

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      const event = new KeyboardEvent('keydown', { key: 'r', bubbles: true });
      Object.defineProperty(event, 'target', { value: input });
      input.dispatchEvent(event);
      expect(onStart).not.toHaveBeenCalled();
    });
  });
});
