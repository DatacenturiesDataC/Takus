// Takus — Shortcut Registry Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../storage.js', () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  saveSetting: vi.fn(() => Promise.resolve()),
}));

import {
  loadShortcuts,
  getShortcuts,
  setShortcut,
  registerShortcut,
  unregisterShortcut,
  getAllShortcuts,
  matchShortcut,
  disableGlobalShortcuts,
} from '../shortcut-registry.js';

describe('Shortcut Registry', () => {
  beforeEach(() => {
    disableGlobalShortcuts();
    // Clear all registered shortcuts
    for (const s of getAllShortcuts()) {
      unregisterShortcut(s.id);
    }
  });

  describe('loadShortcuts', () => {
    it('returns default shortcuts', async () => {
      const shortcuts = await loadShortcuts();
      expect(shortcuts.record).toBe('r');
      expect(shortcuts.pause).toBe(' ');
      expect(shortcuts.stop).toBe('s');
    });
  });

  describe('getShortcuts', () => {
    it('returns a copy of current shortcuts', () => {
      const s = getShortcuts();
      expect(s.record).toBe('r');
      // Mutating the copy shouldn't affect the source
      s.record = 'x';
      expect(getShortcuts().record).toBe('r');
    });
  });

  describe('setShortcut', () => {
    it('updates a shortcut', async () => {
      await setShortcut('record', 'q');
      expect(getShortcuts().record).toBe('q');
      // Reset
      await setShortcut('record', 'r');
    });
  });

  describe('registerShortcut', () => {
    it('registers a shortcut', () => {
      const handler = vi.fn();
      registerShortcut('test:action', {
        key: 't',
        label: 'Test Action',
        handler,
        appId: 'test',
      });

      const all = getAllShortcuts();
      expect(all).toHaveLength(1);
      expect(all[0].key).toBe('t');
      expect(all[0].label).toBe('Test Action');
      expect(all[0].appId).toBe('test');
    });

    it('allows overwriting existing shortcuts', () => {
      registerShortcut('test:action', { key: 't', label: 'V1', handler: vi.fn() });
      registerShortcut('test:action', { key: 'u', label: 'V2', handler: vi.fn() });

      const all = getAllShortcuts();
      expect(all).toHaveLength(1);
      expect(all[0].key).toBe('u');
    });
  });

  describe('unregisterShortcut', () => {
    it('removes a shortcut', () => {
      registerShortcut('test:remove', { key: 'x', label: 'Remove Me', handler: vi.fn() });
      expect(getAllShortcuts()).toHaveLength(1);

      unregisterShortcut('test:remove');
      expect(getAllShortcuts()).toHaveLength(0);
    });
  });

  describe('matchShortcut', () => {
    it('matches a registered shortcut', () => {
      registerShortcut('test:match', { key: 'k', label: 'Match', handler: vi.fn() });

      const event = { key: 'k', target: { tagName: 'DIV' }, metaKey: false, ctrlKey: false };
      const match = matchShortcut(event);
      expect(match).not.toBeNull();
      expect(match.id).toBe('test:match');
    });

    it('returns null for non-matching keys', () => {
      registerShortcut('test:match', { key: 'k', label: 'Match', handler: vi.fn() });

      const event = { key: 'z', target: { tagName: 'DIV' }, metaKey: false, ctrlKey: false };
      expect(matchShortcut(event)).toBeNull();
    });

    it('ignores shortcuts when typing in input', () => {
      registerShortcut('test:input', { key: 'k', label: 'Input', handler: vi.fn() });

      const event = { key: 'k', target: { tagName: 'INPUT' }, metaKey: false, ctrlKey: false };
      expect(matchShortcut(event)).toBeNull();
    });

    it('ignores shortcuts when typing in textarea', () => {
      registerShortcut('test:textarea', { key: 'k', label: 'Textarea', handler: vi.fn() });

      const event = { key: 'k', target: { tagName: 'TEXTAREA' }, metaKey: false, ctrlKey: false };
      expect(matchShortcut(event)).toBeNull();
    });

    it('ignores shortcuts in contentEditable', () => {
      registerShortcut('test:editable', { key: 'k', label: 'Editable', handler: vi.fn() });

      const event = { key: 'k', target: { tagName: 'DIV', isContentEditable: true }, metaKey: false, ctrlKey: false };
      expect(matchShortcut(event)).toBeNull();
    });

    it('matches meta key shortcuts', () => {
      registerShortcut('test:meta', { key: 'k', label: 'Meta', handler: vi.fn(), metaKey: true });

      const noMeta = { key: 'k', target: { tagName: 'DIV' }, metaKey: false, ctrlKey: false };
      // Without meta, metaKey shortcut won't have metaKey check pass
      // Actually our logic: metaMatch = config.metaKey ? (event.metaKey || event.ctrlKey) : true
      // So if config.metaKey=true but event.metaKey=false, metaMatch=false → no match
      const match1 = matchShortcut(noMeta);
      expect(match1).toBeNull();

      const withMeta = { key: 'k', target: { tagName: 'DIV' }, metaKey: true, ctrlKey: false };
      const match2 = matchShortcut(withMeta);
      expect(match2).not.toBeNull();
      expect(match2.id).toBe('test:meta');
    });
  });

  describe('getAllShortcuts', () => {
    it('returns registered shortcuts with metadata', () => {
      registerShortcut('a:1', { key: 'a', label: 'Alpha', handler: vi.fn(), appId: 'app-a' });
      registerShortcut('b:2', { key: 'b', label: 'Beta', handler: vi.fn(), appId: 'app-b' });

      const all = getAllShortcuts();
      expect(all).toHaveLength(2);
      expect(all.map(s => s.appId)).toEqual(expect.arrayContaining(['app-a', 'app-b']));
    });
  });
});
