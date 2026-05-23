
// Manages the main tab panels and mobile bottom navigation.
// Replaces the legacy top tab bar with collapsible sidebar routing on desktop
// and a bottom navigation bar + "More" sheet drawer on mobile.

import { icons } from '../lib/icons.js';
import { renderInsightsPanel } from './insights-panel.js';
import { renderSettingsInline } from './settings-panel.js';
import { renderConnectInline } from './connect-panel.js';
import { esc } from '../lib/utils.js';

// ── Slot Map ─────────────────────────────────────────────────────────────────

/** Maps nav ID → DOM slot ID */
const SLOT_MAP = {
  history: 'history-slot',
  tasks: 'tasks-global-slot',
  people: 'people-slot',
  insights: 'insights-slot',
  apps: 'apps-slot',
  settings: 'settings-slot',
};

// ── Build ────────────────────────────────────────────────────────────────────

/**
 * Build panel slots and mobile navigation HTML.
 *
 * @param {function} getNavItems — Returns app-contributed nav items
 * @param {string} [activeTabId] — The currently active tab ID
 * @returns {{ html: string, resolvedTabs: object[] }}
 */
export function buildTabBarHTML(getNavItems, activeTabId) {
  let appNavItems = [];
  try {
    appNavItems = getNavItems();
  } catch { /* non-critical */ }

  // System tabs that aren't provided by apps
  const systemTabs = [
    { id: 'apps', label: 'Apps', order: 90 },
    { id: 'settings', label: 'Settings', order: 99 },
  ];

  // If no app nav items yet, use hardcoded defaults
  if (appNavItems.length === 0) {
    appNavItems = [
      { id: 'history', label: 'Library', order: 10 },
      { id: 'tasks', label: 'Tasks', order: 20 },
      { id: 'people', label: 'People', order: 30 },
      { id: 'insights', label: 'Insights', order: 40 },
    ];
  }

  const allTabs = [...appNavItems, ...systemTabs].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

  const currentActiveTabId = (activeTabId && allTabs.some(t => t.id === activeTabId))
    ? activeTabId
    : (allTabs[0]?.id || 'history');

  // Generate panel slots (same as before)
  const panelSlots = allTabs.map((tab) => {
    const slotId = SLOT_MAP[tab.id] || `${tab.id}-slot`;
    const isActive = tab.id === currentActiveTabId;
    return `<div id="${slotId}" class="tab-panel" data-tab-panel="${tab.id}" role="tabpanel" aria-labelledby="tab-${tab.id}" style="${isActive ? '' : 'display: none;'}"></div>`;
  }).join('\n            ');

  // Render mobile bottom navigation (5 items: Home, Library, Tasks, Ask, More)
  const bottomNavHTML = `
    <nav class="mobile-bottom-nav" aria-label="Mobile navigation">
      <button class="mobile-nav-item${currentActiveTabId === 'home' ? ' active' : ''}" data-nav="home" aria-label="Home">
        ${icons.layout(20)}
        <span class="mobile-nav-label">Home</span>
      </button>
      <button class="mobile-nav-item${currentActiveTabId === 'history' ? ' active' : ''}" data-nav="history" aria-label="Library">
        ${icons.bookOpen(20)}
        <span class="mobile-nav-label">Library</span>
      </button>
      <button class="mobile-nav-item${currentActiveTabId === 'tasks' ? ' active' : ''}" data-nav="tasks" aria-label="Tasks" style="position:relative;">
        ${icons.checkSquare(20)}
        <span class="mobile-nav-label">Tasks</span>
        <span class="tab-badge" id="mobile-tasks-badge" style="display:none;position:absolute;top:2px;right:16px;"></span>
      </button>
      <button class="mobile-nav-item${currentActiveTabId === 'ask' ? ' active' : ''}" data-nav="ask" aria-label="Ask">
        ${icons.messageSquare(20)}
        <span class="mobile-nav-label">Ask</span>
      </button>
      <button class="mobile-nav-item" id="mobile-more-btn" aria-label="More navigation options">
        ${icons.grid(20)}
        <span class="mobile-nav-label">More</span>
      </button>
    </nav>
  `;

  // Render mobile "More" bottom sheet drawer dynamically based on active apps
  const bottomNavIds = ['history', 'tasks', 'ask'];
  const moreSheetTabs = allTabs.filter(t => !bottomNavIds.includes(t.id));

  const ICON_MAP = {
    home: 'layout',
    history: 'bookOpen',
    ask: 'messageSquare',
    documents: 'edit',
    tasks: 'checkSquare',
    goals: 'flag',
    calendar: 'calendar',
    inbox: 'inbox',
    people: 'users',
    chat: 'send',
    insights: 'barChart',
    drive: 'cloud',
    integrations: 'link',
    archive: 'package',
    settings: 'settings',
    feedback: 'flag',
    apps: 'grid',
  };

  const moreSheetItemsHTML = moreSheetTabs.map(tab => {
    const iconName = ICON_MAP[tab.id] || 'flag';
    const iconFn = icons[iconName];
    const iconHTML = iconFn ? iconFn(18) : '';
    const activeClass = tab.id === currentActiveTabId ? ' active' : '';
    return `
          <button class="mobile-sheet-item${activeClass}" data-nav="${esc(tab.id)}">
            ${iconHTML}
            <span>${esc(tab.label)}</span>
          </button>`;
  }).join('\n');

  const bottomSheetHTML = `
    <div id="mobile-more-sheet" class="mobile-sheet hidden" aria-hidden="true">
      <div class="mobile-sheet-overlay"></div>
      <div class="mobile-sheet-content">
        <div class="mobile-sheet-header">
          <span class="mobile-sheet-title">Navigate</span>
          <button class="mobile-sheet-close" aria-label="Close menu">${icons.x(16)}</button>
        </div>
        <div class="mobile-sheet-body">
          ${moreSheetItemsHTML}
        </div>
      </div>
    </div>
  `;

  const html = `
    ${panelSlots}
    ${bottomNavHTML}
    ${bottomSheetHTML}
  `;

  return { html, resolvedTabs: allTabs };
}

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize mobile navigation: click handlers, sheet interactions, badges.
 *
 * @param {object} deps
 * @param {object[]} deps.resolvedTabs — Tab definitions
 * @param {function} deps.updateTaskBadge — Callback to refresh task badge
 * @param {function} deps.refreshShortcuts — Callback to refresh keyboard shortcuts
 * @param {function} deps.onTabSwitch — Called with (tabId) when a tab is activated
 * @param {number} [deps.lastEntryTs] — Timestamp of last entry
 */
export function initMainTabs(deps) {
  const { resolvedTabs, updateTaskBadge, refreshShortcuts, onTabSwitch } = deps;

  const bottomNav = document.querySelector('.mobile-bottom-nav');
  const sheet = document.getElementById('mobile-more-sheet');
  if (!bottomNav || !sheet) return;

  const overlay = sheet.querySelector('.mobile-sheet-overlay');
  const closeBtn = sheet.querySelector('.mobile-sheet-close');

  // Populate task badge count
  updateTaskBadge();

  // Helper to close sheet
  const closeSheet = () => {
    sheet.classList.add('hidden');
    sheet.setAttribute('aria-hidden', 'true');
  };

  // Helper to open sheet
  const openSheet = () => {
    sheet.classList.remove('hidden');
    sheet.setAttribute('aria-hidden', 'false');
  };

  // Mobile Bottom Nav Click Handlers
  bottomNav.addEventListener('click', (e) => {
    const item = e.target.closest('.mobile-nav-item');
    if (!item) return;

    if (item.id === 'mobile-more-btn') {
      openSheet();
      return;
    }

    const tabId = item.dataset.nav;
    if (tabId) {
      // Close entry detail if open
      const detailSlot = document.getElementById('entry-detail-slot');
      if (detailSlot && detailSlot.style.display !== 'none' && detailSlot.innerHTML) {
        const backBtn = detailSlot.querySelector('#rd-back');
        if (backBtn) backBtn.click();
      }

      // Update active states in bottom nav
      bottomNav.querySelectorAll('.mobile-nav-item').forEach(b => {
        b.classList.toggle('active', b === item);
      });

      // Show/hide panels
      document.querySelectorAll('.tab-panel').forEach(el => {
        el.style.display = el.dataset.tabPanel === tabId ? '' : 'none';
      });

      lazyRenderTab(tabId, { resolvedTabs, updateTaskBadge, refreshShortcuts, lastEntryTs: deps.lastEntryTs });
      onTabSwitch?.(tabId);
    }
  });

  // Mobile More Sheet Click Handlers
  sheet.addEventListener('click', (e) => {
    const item = e.target.closest('.mobile-sheet-item');
    if (item) {
      const tabId = item.dataset.nav;
      if (tabId) {
        closeSheet();

        // Update active states in bottom nav (remove active since it's in sheet)
        bottomNav.querySelectorAll('.mobile-nav-item').forEach(b => {
          b.classList.remove('active');
        });

        // Show/hide panels
        document.querySelectorAll('.tab-panel').forEach(el => {
          el.style.display = el.dataset.tabPanel === tabId ? '' : 'none';
        });

        lazyRenderTab(tabId, { resolvedTabs, updateTaskBadge, refreshShortcuts, lastEntryTs: deps.lastEntryTs });
        onTabSwitch?.(tabId);
      }
      return;
    }

    if (e.target === overlay || e.target.closest('.mobile-sheet-close')) {
      closeSheet();
    }
  });

  // Keyboard accessibility
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSheet();
    }
  });
}

// ── Lazy Render ──────────────────────────────────────────────────────────────

/**
 * Lazy-render a tab panel. Delegates to app renderPanel() or system handlers.
 *
 * @param {string} tabId
 * @param {object} deps
 */
export async function lazyRenderTab(tabId, deps = {}) {
  const slotId = SLOT_MAP[tabId] || `${tabId}-slot`;
  const slot = document.getElementById(slotId);
  if (!slot) return;

  const stale = slot.dataset.renderedAt && Number(slot.dataset.renderedAt) < (deps.lastEntryTs || 0);

  // System tabs
  if (tabId === 'apps') {
    if (!slot.dataset.rendered) {
      slot.dataset.rendered = '1';
      import('./app-manager.js').then(m => m.renderAppManager(slot)).catch(() => {
        renderConnectInline(slot).catch(() => {});
      });
    }
    return;
  }

  if (tabId === 'settings') {
    if (!slot.dataset.rendered) {
      slot.dataset.rendered = '1';
      renderSettingsInline(slot);
      deps.refreshShortcuts?.();
    }
    return;
  }

  // Task badge refresh
  if (tabId === 'tasks') {
    deps.updateTaskBadge?.();
  }

  // Try to delegate to the app's renderPanel()
  if (!slot.dataset.rendered || stale) {
    slot.dataset.rendered = '1';
    slot.dataset.renderedAt = String(Date.now());

    // Show loading skeleton while module loads
    if (!slot.innerHTML.trim()) {
      slot.innerHTML = `
        <div class="card card-compact pad-stack" >
          <div style="height:16px;width:30%;border-radius:var(--radius-sm);background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
          <div style="height:12px;width:60%;border-radius:var(--radius-sm);background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
          <div style="height:12px;width:45%;border-radius:var(--radius-sm);background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
        </div>`;
    }

    try {
      const { getActiveApps } = await import('../lib/app-manager.js');
      const app = getActiveApps().find(a => {
        const nav = a.getNavItem();
        return nav && nav.id === tabId;
      });

      if (app && typeof app.renderPanel === 'function') {
        await app.renderPanel(slot);
        return;
      }
    } catch { /* non-critical */ }

    // Hardcoded fallbacks
    if (tabId === 'insights') {
      renderInsightsPanel(slot).catch(() => {});
    } else if (tabId === 'tasks') {
      import('./global-tasks-panel.js').then(m => m.renderGlobalTasksPanel(slot)).catch(() => {});
    } else if (tabId === 'people') {
      import('./contacts-panel.js').then(m => m.renderContactsPanel(slot)).catch(() => {});
    }
  }
}
