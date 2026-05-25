
// Unit tests for the Tab Manager component.
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all heavy dependencies that tab-manager.js imports
vi.mock('../../lib/icons.js', () => ({
  icons: {
    layout:       (s) => `<svg data-icon="layout" width="${s}"></svg>`,
    bookOpen:     (s) => `<svg data-icon="bookOpen" width="${s}"></svg>`,
    checkSquare:  (s) => `<svg data-icon="checkSquare" width="${s}"></svg>`,
    messageSquare:(s) => `<svg data-icon="messageSquare" width="${s}"></svg>`,
    grid:         (s) => `<svg data-icon="grid" width="${s}"></svg>`,
    settings:     (s) => `<svg data-icon="settings" width="${s}"></svg>`,
    flag:         (s) => `<svg data-icon="flag" width="${s}"></svg>`,
    x:            (s) => `<svg data-icon="x" width="${s}"></svg>`,
    barChart:     (s) => `<svg data-icon="barChart" width="${s}"></svg>`,
    users:        (s) => `<svg data-icon="users" width="${s}"></svg>`,
  },
}));

vi.mock('../../lib/utils.js', () => ({
  esc: (str) => String(str ?? ''),
}));

vi.mock('../insights-panel.js', () => ({ renderInsightsPanel: vi.fn() }));
vi.mock('../settings-panel.js', () => ({ renderSettingsInline: vi.fn() }));
vi.mock('../connect-panel.js',  () => ({ renderConnectInline: vi.fn() }));

const { buildTabBarHTML, initMainTabs } = await import('../tab-manager.js');

describe('Tab Manager', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── buildTabBarHTML ────────────────────────────────────────────────────

  describe('buildTabBarHTML', () => {
    it('returns HTML string and resolvedTabs array', () => {
      const result = buildTabBarHTML(() => [], undefined);
      expect(typeof result.html).toBe('string');
      expect(Array.isArray(result.resolvedTabs)).toBe(true);
    });

    it('always includes system tabs (apps, settings)', () => {
      const { resolvedTabs } = buildTabBarHTML(() => [], undefined);
      const ids = resolvedTabs.map(t => t.id);
      expect(ids).toContain('apps');
      expect(ids).toContain('settings');
    });

    it('uses hardcoded defaults when getNavItems returns empty', () => {
      const { resolvedTabs } = buildTabBarHTML(() => [], undefined);
      const ids = resolvedTabs.map(t => t.id);
      expect(ids).toContain('history');
      expect(ids).toContain('tasks');
      expect(ids).toContain('people');
      expect(ids).toContain('insights');
    });

    it('uses app-provided nav items when available', () => {
      const customItems = [
        { id: 'custom1', label: 'Custom 1', order: 5 },
        { id: 'custom2', label: 'Custom 2', order: 15 },
      ];
      const { resolvedTabs } = buildTabBarHTML(() => customItems, undefined);
      const ids = resolvedTabs.map(t => t.id);
      expect(ids).toContain('custom1');
      expect(ids).toContain('custom2');
      // Should NOT have the hardcoded defaults
      expect(ids).not.toContain('history');
    });

    it('sorts tabs by order', () => {
      const items = [
        { id: 'b', label: 'B', order: 20 },
        { id: 'a', label: 'A', order: 10 },
      ];
      const { resolvedTabs } = buildTabBarHTML(() => items, undefined);
      const nonSystemIds = resolvedTabs.filter(t => t.id !== 'apps' && t.id !== 'settings').map(t => t.id);
      expect(nonSystemIds[0]).toBe('a');
      expect(nonSystemIds[1]).toBe('b');
    });

    it('handles getNavItems throwing without crashing', () => {
      const result = buildTabBarHTML(() => { throw new Error('boom'); }, undefined);
      expect(result.resolvedTabs.length).toBeGreaterThan(0);
    });
  });

  // ── Tab Registration (resolvedTabs) ────────────────────────────────────

  describe('Tab registration', () => {
    it('generates panel slot HTML for each tab', () => {
      const { html, resolvedTabs } = buildTabBarHTML(() => [], undefined);
      for (const tab of resolvedTabs) {
        expect(html).toContain(`data-tab-panel="${tab.id}"`);
      }
    });

    it('sets role="tabpanel" on each panel slot', () => {
      const { html } = buildTabBarHTML(() => [], undefined);
      expect(html).toContain('role="tabpanel"');
    });
  });

  // ── Active Tab Tracking ────────────────────────────────────────────────

  describe('Active tab tracking', () => {
    it('makes the specified activeTabId visible (no display:none)', () => {
      const { html } = buildTabBarHTML(() => [], 'tasks');
      // The active panel should not have display: none
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
      const activePanel = doc.querySelector('[data-tab-panel="tasks"]');
      expect(activePanel).toBeTruthy();
      expect(activePanel.style.display).not.toBe('none');
    });

    it('hides non-active panels with display:none', () => {
      const { html } = buildTabBarHTML(() => [], 'tasks');
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
      const hiddenPanel = doc.querySelector('[data-tab-panel="history"]');
      expect(hiddenPanel).toBeTruthy();
      expect(hiddenPanel.style.display).toBe('none');
    });

    it('defaults to the first tab when activeTabId is invalid', () => {
      const { html, resolvedTabs } = buildTabBarHTML(() => [], 'nonexistent');
      const firstId = resolvedTabs[0].id;
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
      const firstPanel = doc.querySelector(`[data-tab-panel="${firstId}"]`);
      expect(firstPanel.style.display).not.toBe('none');
    });

    it('defaults to the first tab when activeTabId is undefined', () => {
      const { html, resolvedTabs } = buildTabBarHTML(() => [], undefined);
      const firstId = resolvedTabs[0].id;
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
      const firstPanel = doc.querySelector(`[data-tab-panel="${firstId}"]`);
      expect(firstPanel.style.display).not.toBe('none');
    });
  });

  // ── Mobile Bottom Navigation ───────────────────────────────────────────

  describe('Mobile bottom navigation', () => {
    it('renders a mobile-bottom-nav element', () => {
      const { html } = buildTabBarHTML(() => [], undefined);
      expect(html).toContain('mobile-bottom-nav');
    });

    it('includes Home, Library, Tasks, Ask, More buttons', () => {
      const { html } = buildTabBarHTML(() => [], undefined);
      expect(html).toContain('data-nav="home"');
      expect(html).toContain('data-nav="history"');
      expect(html).toContain('data-nav="tasks"');
      expect(html).toContain('data-nav="ask"');
      expect(html).toContain('id="mobile-more-btn"');
    });

    it('marks the active tab in the bottom nav', () => {
      const { html } = buildTabBarHTML(() => [], 'tasks');
      // Parse the HTML and find the tasks button
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
      const tasksBtn = doc.querySelector('[data-nav="tasks"]');
      expect(tasksBtn.classList.contains('active')).toBe(true);
    });
  });

  // ── More Sheet ─────────────────────────────────────────────────────────

  describe('More sheet drawer', () => {
    it('renders a mobile-more-sheet element', () => {
      const { html } = buildTabBarHTML(() => [], undefined);
      expect(html).toContain('id="mobile-more-sheet"');
    });

    it('includes non-bottom-nav tabs in the sheet', () => {
      const { html } = buildTabBarHTML(() => [], undefined);
      // "people", "insights", "apps", "settings" should be in the sheet
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
      const sheetItems = doc.querySelectorAll('.mobile-sheet-item');
      const sheetIds = [...sheetItems].map(item => item.dataset.nav);
      expect(sheetIds).toContain('people');
      expect(sheetIds).toContain('settings');
    });

    it('excludes bottom-nav tabs (history, tasks, ask) from the sheet', () => {
      const { html } = buildTabBarHTML(() => [], undefined);
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
      const sheetItems = doc.querySelectorAll('.mobile-sheet-item');
      const sheetIds = [...sheetItems].map(item => item.dataset.nav);
      expect(sheetIds).not.toContain('history');
      expect(sheetIds).not.toContain('tasks');
      expect(sheetIds).not.toContain('ask');
    });
  });

  // ── initMainTabs & Event Dispatching ───────────────────────────────────

  describe('initMainTabs and event dispatching on tab change', () => {
    let onTabSwitch;

    beforeEach(() => {
      onTabSwitch = vi.fn();
      const { html, resolvedTabs } = buildTabBarHTML(() => [], 'history');
      document.body.innerHTML = html;

      initMainTabs({
        resolvedTabs,
        updateTaskBadge: vi.fn(),
        refreshShortcuts: vi.fn(),
        onTabSwitch,
      });
    });

    it('calls onTabSwitch when a bottom nav item is clicked', () => {
      const tasksBtn = document.querySelector('[data-nav="tasks"]');
      tasksBtn.click();
      expect(onTabSwitch).toHaveBeenCalledWith('tasks');
    });

    it('updates active class on bottom nav items', () => {
      const tasksBtn = document.querySelector('[data-nav="tasks"]');
      const historyBtn = document.querySelector('[data-nav="history"]');
      tasksBtn.click();
      expect(tasksBtn.classList.contains('active')).toBe(true);
      expect(historyBtn.classList.contains('active')).toBe(false);
    });

    it('shows the correct panel and hides others on tab switch', () => {
      const tasksBtn = document.querySelector('[data-nav="tasks"]');
      tasksBtn.click();
      const tasksPanel = document.querySelector('[data-tab-panel="tasks"]');
      const historyPanel = document.querySelector('[data-tab-panel="history"]');
      expect(tasksPanel.style.display).toBe('');
      expect(historyPanel.style.display).toBe('none');
    });

    it('opens the More sheet when More button is clicked', () => {
      const moreBtn = document.getElementById('mobile-more-btn');
      moreBtn.click();
      const sheet = document.getElementById('mobile-more-sheet');
      expect(sheet.classList.contains('hidden')).toBe(false);
    });

    it('closes the More sheet when a sheet item is clicked', () => {
      // Open the sheet first
      document.getElementById('mobile-more-btn').click();
      const sheet = document.getElementById('mobile-more-sheet');
      expect(sheet.classList.contains('hidden')).toBe(false);

      // Click a sheet item
      const sheetItem = sheet.querySelector('.mobile-sheet-item');
      if (sheetItem) {
        sheetItem.click();
        expect(sheet.classList.contains('hidden')).toBe(true);
      }
    });

    it('dispatches onTabSwitch when a More sheet item is clicked', () => {
      document.getElementById('mobile-more-btn').click();
      const sheet = document.getElementById('mobile-more-sheet');
      const sheetItem = sheet.querySelector('.mobile-sheet-item');
      if (sheetItem) {
        const tabId = sheetItem.dataset.nav;
        sheetItem.click();
        expect(onTabSwitch).toHaveBeenCalledWith(tabId);
      }
    });

    it('closes the More sheet on Escape key', () => {
      document.getElementById('mobile-more-btn').click();
      const sheet = document.getElementById('mobile-more-sheet');
      expect(sheet.classList.contains('hidden')).toBe(false);

      sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(sheet.classList.contains('hidden')).toBe(true);
    });

    it('closes the More sheet when overlay is clicked', () => {
      document.getElementById('mobile-more-btn').click();
      const sheet = document.getElementById('mobile-more-sheet');
      const overlay = sheet.querySelector('.mobile-sheet-overlay');
      overlay.click();
      expect(sheet.classList.contains('hidden')).toBe(true);
    });
  });
});
