
// Manages the main tab bar: building, rendering, switching, lazy loading.
// Extracted from AppShell to keep the shell focused on state routing.

import { icons } from '../lib/icons.js';
import { renderInsightsPanel } from './insights-panel.js';
import { renderSettingsInline } from './settings-panel.js';
import { renderConnectInline } from './connect-panel.js';

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

/** Maps nav ID → icon function */
const TAB_ICONS = {
  history: icons.clock, tasks: icons.zap, people: icons.users,
  insights: icons.barChart, apps: icons.grid, settings: icons.settings,
  calendar: icons.calendar, drive: icons.cloud, inbox: icons.inbox,
};

// ── Build ────────────────────────────────────────────────────────────────────

/**
 * Build tab bar HTML and panel slots from nav items.
 *
 * @param {function} getNavItems — Returns app-contributed nav items
 * @returns {{ html: string, resolvedTabs: object[] }}
 */
export function buildTabBarHTML(getNavItems) {
  let appNavItems = [];
  try {
    appNavItems = getNavItems();
  } catch {}

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

  const tabButtons = allTabs.map((tab, i) => {
    const slotId = SLOT_MAP[tab.id] || `${tab.id}-slot`;
    const isFirst = i === 0;
    return `<button class="main-tab${isFirst ? ' active' : ''}" data-tab="${tab.id}" role="tab" aria-selected="${isFirst ? 'true' : 'false'}" aria-controls="${slotId}" aria-label="${tab.label}" id="tab-${tab.id}"></button>`;
  }).join('\n              ');

  const panelSlots = allTabs.map((tab, i) => {
    const slotId = SLOT_MAP[tab.id] || `${tab.id}-slot`;
    const isFirst = i === 0;
    return `<div id="${slotId}" class="tab-panel" data-tab-panel="${tab.id}" role="tabpanel" aria-labelledby="tab-${tab.id}"${isFirst ? '' : ''}></div>`;
  }).join('\n            ');

  const html = `
            <nav aria-label="Main navigation">
            <div id="main-tab-bar" class="main-tab-bar" role="tablist">
              ${tabButtons}
            </div>
            </nav>
            ${panelSlots}`;

  return { html, resolvedTabs: allTabs };
}

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize tab bar interactivity: labels, badges, click/keyboard handlers.
 *
 * @param {object} deps
 * @param {object[]} deps.resolvedTabs — Tab definitions from buildTabBarHTML
 * @param {function} deps.updateTaskBadge — Callback to refresh task badge
 * @param {function} deps.refreshShortcuts — Callback to refresh keyboard shortcuts
 * @param {function} deps.onTabSwitch — Called with (tabId) when a tab is activated
 * @param {number} [deps.lastEntryTs] — Timestamp of last entry (for staleness)
 */
export function initMainTabs(deps) {
  const tabBar = document.getElementById('main-tab-bar');
  if (!tabBar) return;

  const { resolvedTabs, updateTaskBadge, refreshShortcuts, onTabSwitch } = deps;

  // Populate labels from resolved tabs
  tabBar.querySelectorAll('.main-tab').forEach(btn => {
    const tabId = btn.dataset.tab;
    const tabDef = resolvedTabs.find(t => t.id === tabId);
    const iconFn = TAB_ICONS[tabId];
    const label = tabDef?.label || tabId;
    const iconHtml = iconFn ? iconFn(13) : (tabDef?.icon || '');
    const hasBadge = tabDef?.getBadgeCount && typeof tabDef.getBadgeCount === 'function';
    const badgeHtml = hasBadge ? `<span class="tab-badge" id="${tabId}-badge"></span>` : '';
    btn.innerHTML = `${iconHtml} <span class="tab-label">${label}</span>${badgeHtml}`;
  });

  // Populate task badge count
  updateTaskBadge();

  // Click handler
  tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.main-tab');
    if (!tab) return;
    const which = tab.dataset.tab;

    // Close entry detail if open
    const detailSlot = document.getElementById('entry-detail-slot');
    if (detailSlot && detailSlot.style.display !== 'none' && detailSlot.innerHTML) {
      const backBtn = detailSlot.querySelector('#rd-back');
      if (backBtn) backBtn.click();
    }

    // Update active states
    tabBar.querySelectorAll('.main-tab').forEach(b => {
      const isActive = b === tab;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Show/hide panels
    document.querySelectorAll('.tab-panel').forEach(el => {
      el.style.display = el.dataset.tabPanel === which ? '' : 'none';
    });

    // Lazy-render
    lazyRenderTab(which, { resolvedTabs, updateTaskBadge, refreshShortcuts, lastEntryTs: deps.lastEntryTs });
    onTabSwitch?.(which);
  });

  // Arrow-key navigation (ARIA tablist pattern)
  tabBar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tabs = [...tabBar.querySelectorAll('.main-tab')];
    const idx = tabs.indexOf(document.activeElement);
    if (idx < 0) return;
    e.preventDefault();
    const next = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
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
        <div class="card card-compact" class="pad-stack">
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
    } catch {}

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
