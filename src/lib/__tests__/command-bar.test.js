// Takus — Command Bar Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock storage
vi.mock('../../lib/storage.js', () => ({
  getEntries: vi.fn(() => Promise.resolve([
    { id: 'r1', title: 'Sprint Retro', aiSummary: 'Team discussed improvements', date: Date.now(), type: 'meeting' },
    { id: 'r2', title: 'Bug Demo', aiSummary: 'Showed the regression', date: Date.now(), type: 'screen' },
  ])),
  getContacts: vi.fn(() => Promise.resolve([
    { id: 'c1', name: 'Alice Johnson', email: 'alice@co.com' },
    { id: 'c2', name: 'Bob Smith', email: 'bob@co.com' },
  ])),
}));

vi.mock('../../lib/events.js', () => ({
  OPEN_ENTRY: 'takus:open-entry', OPEN_RECORDING: 'takus:open-entry',
}));

vi.mock('../../lib/icons.js', () => ({
  icons: new Proxy({}, {
    get: () => (s) => `<svg width="${s}" height="${s}"></svg>`,
  }),
}));

vi.mock('../../lib/utils.js', () => ({
  esc: (s) => s,
}));

import {
  openCommandBar,
  closeCommandBar,
  isCommandBarOpen,
  registerCommand,
} from '../../components/command-bar.js';

beforeEach(() => {
  closeCommandBar();
});

afterEach(() => {
  closeCommandBar();
});

describe('Command Bar', () => {
  it('exports required functions', () => {
    expect(typeof openCommandBar).toBe('function');
    expect(typeof isCommandBarOpen).toBe('function');
    expect(typeof registerCommand).toBe('function');
  });

  it('is not open initially', () => {
    expect(isCommandBarOpen()).toBe(false);
  });

  it('opens and creates overlay', () => {
    openCommandBar();
    expect(isCommandBarOpen()).toBe(true);
    expect(document.getElementById('command-bar-overlay')).not.toBeNull();
    expect(document.getElementById('command-bar-input')).not.toBeNull();
    expect(document.getElementById('command-bar-results')).not.toBeNull();
  });

  it('has ARIA attributes on overlay', () => {
    openCommandBar();
    const overlay = document.getElementById('command-bar-overlay');
    expect(overlay.getAttribute('role')).toBe('dialog');
    expect(overlay.getAttribute('aria-modal')).toBe('true');
    expect(overlay.getAttribute('aria-label')).toBe('Command bar');
  });

  it('idempotent open (no double overlay)', () => {
    openCommandBar();
    openCommandBar(); // second call should be no-op
    const overlays = document.querySelectorAll('#command-bar-overlay');
    expect(overlays.length).toBe(1);
  });

  it('closes on Escape', () => {
    openCommandBar();
    const input = document.getElementById('command-bar-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isCommandBarOpen()).toBe(false);
  });

  it('shows results container', () => {
    openCommandBar();
    const results = document.getElementById('command-bar-results');
    expect(results).not.toBeNull();
    // Initial render should show commands (non-empty)
    expect(results.innerHTML.length).toBeGreaterThan(0);
  });

  it('registerCommand adds a custom command', () => {
    const action = vi.fn();
    registerCommand({ id: 'test:custom', label: 'Custom Command', category: 'Test', action });
    openCommandBar();
    const results = document.getElementById('command-bar-results');
    expect(results.innerHTML).toContain('Custom Command');
  });

  it('registerCommand deduplicates by ID', () => {
    registerCommand({ id: 'test:dedup', label: 'First', category: 'Test', action: vi.fn() });
    registerCommand({ id: 'test:dedup', label: 'Second', category: 'Test', action: vi.fn() });
    openCommandBar();
    const results = document.getElementById('command-bar-results');
    expect(results.innerHTML).toContain('First');
    expect(results.innerHTML).not.toContain('Second');
  });
});
