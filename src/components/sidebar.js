// Takus — Sidebar Navigation
// Collapsible sidebar inspired by Linear/Notion.
// Vertical nav with grouped sections, icon-only collapsed mode,
// and persistent state via localStorage.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { isActive } from '../lib/app-manager.js';
import { SIDEBAR_TOGGLE } from '../lib/events.js';
import { toast } from './toast.js';

// ── Progressive Disclosure ─────────────────────────────────────────────────

// Item IDs visible in beginner mode (simplified sidebar for new users)
const BEGINNER_ITEM_IDS = new Set(['home', 'history', 'ask', 'tasks']);

// Section IDs that can appear in beginner mode (sections containing at least one beginner item)
const BEGINNER_SECTION_IDS = new Set(['main', 'knowledge', 'productivity']);

/**
 * Read the sidebar disclosure mode from localStorage.
 * Returns 'beginner' | 'full'. Defaults to 'beginner' for new users.
 */
function _getSidebarDisclosure() {
  try {
    const val = localStorage.getItem('sidebar_disclosure');
    if (val === 'full') return 'full';
  } catch { /* non-critical */ }
  return 'beginner';
}

/**
 * Check whether the sidebar should show beginner (simplified) mode.
 * This is a synchronous check against localStorage — the async
 * condition evaluations are handled by initSidebarDisclosure().
 * @returns {boolean}
 */
function _isBeginnerMode() {
  return _getSidebarDisclosure() === 'beginner';
}

/**
 * Exit beginner mode: set disclosure to 'full' and re-render the sidebar.
 */
function _exitBeginnerMode() {
  try { localStorage.setItem('sidebar_disclosure', 'full'); } catch { /* non-critical */ }
  if (_container && _onNavigate !== undefined) {
    renderSidebar(_container, { onNavigate: _onNavigate, activeId: _activeId });
  }
}

/**
 * Async check of beginner-mode exit conditions.
 * Promotes to full mode when BOTH conditions are met:
 *   1. User has ≥ 5 entries in storage
 *   2. User has been using Takus for ≥ 14 days (checks 'takus_welcomed' timestamp)
 *   3. User previously clicked 'Show all features'
 *   4. User manually toggled in Settings
 *
 * Call this once during app initialization (e.g. after sidebar render).
 * Conditions 3 & 4 are already handled by direct localStorage writes;
 * this function handles conditions 1 & 2.
 */
export async function initSidebarDisclosure() {
  // Already promoted — nothing to do
  if (_getSidebarDisclosure() === 'full') return;

  let hasEnoughTime = false;
  let hasEnoughEntries = false;

  // Condition 2: Check if user has been using Takus for ≥ 14 days
  try {
    const welcomed = localStorage.getItem('takus_welcomed');
    if (welcomed === '1') {
      // 'takus_welcomed' is set to '1' (not a timestamp) by content-pipeline,
      // so also check install_dismissed which has a timestamp
      const installTs = parseInt(localStorage.getItem('takus_install_dismissed'), 10);
      if (!isNaN(installTs) && Date.now() - installTs >= 14 * 24 * 60 * 60 * 1000) {
        hasEnoughTime = true;
      }
    }
  } catch { /* non-critical */ }

  // Condition 1: Check if user has ≥ 5 entries
  try {
    const { getEntryHeaders } = await import('../lib/storage.js');
    const entries = await getEntryHeaders();
    if (entries.length >= 5) {
      hasEnoughEntries = true;
    }
  } catch { /* non-critical — storage may not be available */ }

  // Promote only when BOTH conditions are met
  if (hasEnoughTime && hasEnoughEntries) {
    _exitBeginnerMode();
  }
}

// ── State ──────────────────────────────────────────────────────────────────

let _collapsed = (() => { try { return localStorage.getItem('takus_sidebar_collapsed') === '1'; } catch { return false; } })();
let _activeId = 'home';
let _onNavigate = null;
let _container = null;

// Collapsed sections persistence
let _collapsedSections = (() => {
  try {
    return JSON.parse(localStorage.getItem('takus_sidebar_sections_collapsed') || '[]');
  } catch { return []; }
})();

// ── Section Definitions ────────────────────────────────────────────────────

const SECTIONS = [
  {
    id: 'main',
    items: [
      { id: 'home', label: 'Home', icon: 'layout' },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    items: [
      { id: 'history', label: 'Library', icon: 'bookOpen', appId: 'recorder' },
      { id: 'ask', label: 'Chat', icon: 'messageSquare', appId: 'ask' },
      { id: 'documents', label: 'Documents', icon: 'edit', appId: 'documents' },
    ],
  },
  {
    id: 'productivity',
    label: 'Productivity',
    items: [
      { id: 'tasks', label: 'Tasks', icon: 'checkSquare', appId: 'tasks' },
      { id: 'goals', label: 'Goals', icon: 'flag', appId: 'goals' },
      { id: 'calendar', label: 'Calendar', icon: 'calendar', appId: 'calendar' },
      { id: 'inbox', label: 'Inbox', icon: 'inbox', appId: 'inbox' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { id: 'people', label: 'People', icon: 'users', appId: 'people' },
      { id: 'chat', label: 'Chat', icon: 'send', appId: 'chat' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'insights', label: 'Insights', icon: 'barChart', appId: 'insights' },
      { id: 'drive', label: 'Drive', icon: 'cloud', appId: 'drive' },
      { id: 'integrations', label: 'Integrations', icon: 'link', appId: 'integrations' },
      { id: 'archive', label: 'Archive', icon: 'package', appId: 'archive' },
    ],
  },
];

const BOTTOM_ITEMS = [
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'feedback', label: 'Feedback', icon: 'messageSquare', appId: 'feedback' },
];

// ── Style Injection ────────────────────────────────────────────────────────

let _stylesInjected = false;

function _injectStyles() {
  // Styles are now in src/styles/sidebar.css, imported via main.js
  if (_stylesInjected) return;
  _stylesInjected = true;
}

// ── Tooltip Management ─────────────────────────────────────────────────────

let _tooltipEl = null;
let _tooltipTimeout = null;

function _ensureTooltip() {
  if (_tooltipEl) return _tooltipEl;
  _tooltipEl = document.createElement('div');
  _tooltipEl.className = 'sidebar-tooltip';
  _tooltipEl.setAttribute('role', 'tooltip');
  _tooltipEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(_tooltipEl);
  return _tooltipEl;
}

function _removeTooltip() {
  if (_tooltipEl) {
    _tooltipEl.remove();
    _tooltipEl = null;
  }
}

function _showTooltip(text, anchorRect) {
  if (!_collapsed) return;
  const tip = _ensureTooltip();
  tip.textContent = text;
  tip.style.top = `${anchorRect.top + anchorRect.height / 2 - 12}px`;
  tip.setAttribute('aria-hidden', 'false');

  // Clear any pending hide
  if (_tooltipTimeout) {
    clearTimeout(_tooltipTimeout);
    _tooltipTimeout = null;
  }

  // Show after a tiny delay to avoid flickering
  requestAnimationFrame(() => {
    tip.classList.add('visible');
  });
}

function _hideTooltip() {
  if (!_tooltipEl) return;
  _tooltipEl.classList.remove('visible');
  _tooltipEl.setAttribute('aria-hidden', 'true');
  _tooltipTimeout = setTimeout(() => {
    _tooltipTimeout = null;
  }, 150);
}

// ── Rendering ──────────────────────────────────────────────────────────────

function _renderItemHTML(item, isActive) {
  const iconFn = icons[item.icon];
  const iconSize = _collapsed ? 20 : 18;
  const iconHTML = iconFn ? iconFn(iconSize) : '';
  const activeClass = isActive ? ' active' : '';
  const ariaLabel = esc(item.label);

  return `<button
    class="sidebar-item${activeClass}"
    id="sidebar-tab-${esc(item.id)}"
    data-sidebar-id="${esc(item.id)}"
    role="tab"
    aria-selected="${isActive ? 'true' : 'false'}"
    aria-label="${ariaLabel}"
    title=""
  >
    <span class="sidebar-item-icon">${iconHTML}</span>
    <span class="sidebar-item-label">${esc(item.label)}</span>
  </button>`;
}

function _renderDisabledItemHTML(item) {
  const iconFn = icons[item.icon];
  const iconSize = _collapsed ? 20 : 18;
  const iconHTML = iconFn ? iconFn(iconSize) : '';
  const ariaLabel = esc(item.label);

  return `<button
    class="sidebar-item disabled"
    data-sidebar-disabled="${esc(item.id)}"
    role="tab"
    aria-selected="false"
    aria-disabled="true"
    aria-label="${ariaLabel}"
    title="Enable in Settings → Labs"
  >
    <span class="sidebar-item-icon">${iconHTML}</span>
    <span class="sidebar-item-label">${esc(item.label)}</span>
  </button>`;
}

function _renderSectionHTML(section) {
  const beginner = _isBeginnerMode();

  // In beginner mode, skip entire sections that aren't in the allowed set
  if (beginner && !BEGINNER_SECTION_IDS.has(section.id)) return '';

  // Filter items: in beginner mode, only show items in the BEGINNER_ITEM_IDS set
  const sectionItems = beginner
    ? section.items.filter(item => BEGINNER_ITEM_IDS.has(item.id))
    : section.items;

  const activeItems = sectionItems.filter(item => {
    if (!item.appId) return true;
    try {
      return isActive(item.appId);
    } catch {
      return true;
    }
  });

  const disabledItems = sectionItems.filter(item => {
    if (!item.appId) return false;
    try {
      return !isActive(item.appId);
    } catch {
      return false;
    }
  });

  if (activeItems.length === 0 && disabledItems.length === 0) return '';

  const isSectionCollapsed = _collapsedSections.includes(section.id);
  const chevronClass = isSectionCollapsed ? ' rotated' : '';
  const chevronHTML = icons.chevronDown ? `<span class="sidebar-section-chevron${chevronClass}">${icons.chevronDown(10)}</span>` : '';

  const labelHTML = section.label
    ? `<div class="sidebar-section-label" data-section-toggle="${esc(section.id)}">
        <span>${esc(section.label)}</span>
        ${chevronHTML}
      </div>`
    : '';

  const activeHTML = activeItems
    .map(item => _renderItemHTML(item, item.id === _activeId))
    .join('\n');

  const disabledHTML = disabledItems
    .map(item => _renderDisabledItemHTML(item))
    .join('\n');

  const allItemsCount = activeItems.length + disabledItems.length;
  // Calculate max-height for animation (items count * ~34px per item)
  const maxH = allItemsCount * 38;
  const collapsedClass = isSectionCollapsed ? ' collapsed' : '';

  return `<div class="sidebar-section" data-section="${esc(section.id)}">
    ${labelHTML}
    <div class="sidebar-section-items${collapsedClass}" style="max-height:${isSectionCollapsed ? 0 : maxH}px;">
      ${activeHTML}
      ${disabledHTML}
    </div>
  </div>`;
}

function _buildHTML() {
  const collapsedClass = _collapsed ? ' collapsed' : '';
  const iconSize = _collapsed ? 20 : 18;

  const sectionsHTML = SECTIONS.map(s => _renderSectionHTML(s))
    .filter(html => html !== '')
    .join('\n<div class="sidebar-divider"></div>\n');

  const beginner = _isBeginnerMode();

  const activeBottomItems = BOTTOM_ITEMS.filter(item => {
    // In beginner mode, only show allowed bottom items
    if (beginner && !BEGINNER_ITEM_IDS.has(item.id)) return false;
    if (!item.appId) return true;
    try {
      return isActive(item.appId);
    } catch {
      return true;
    }
  });

  const bottomItemsHTML = activeBottomItems
    .map(item => _renderItemHTML(item, item.id === _activeId))
    .join('\n');

  // "Explore more features" link for beginner mode
  const zapIcon = icons.zap ? icons.zap(14) : '✨';
  const exploreHTML = beginner
    ? `<button class="sidebar-explore-link" data-sidebar-explore aria-label="Explore more features">
        <span class="sidebar-explore-link-icon">${zapIcon}</span>
        <span class="sidebar-explore-link-label">Explore more features →</span>
      </button>`
    : '';

  const collapseIcon = icons.chevronLeft ? icons.chevronLeft(16) : '‹';

  return `<aside class="sidebar${collapsedClass}" role="navigation" aria-label="Main navigation">
  <div class="sidebar-brand">
    <div class="sidebar-brand-logo" aria-hidden="true">T</div>
    <span class="sidebar-brand-text">Takus</span>
  </div>

  <nav class="sidebar-nav" role="tablist" aria-label="App navigation">
    ${sectionsHTML}
    ${exploreHTML}
  </nav>

  <div class="sidebar-bottom">
    <div class="sidebar-divider"></div>
    ${bottomItemsHTML}
    <button
      class="sidebar-collapse-btn"
      aria-label="${_collapsed ? 'Expand sidebar' : 'Collapse sidebar'}"
      title="${_collapsed ? 'Expand sidebar' : 'Collapse sidebar'}"
    >
      <span class="sidebar-collapse-btn-icon">${collapseIcon}</span>
      <span class="sidebar-collapse-btn-label">Collapse</span>
    </button>
  </div>
</aside>`;
}

// ── Event Binding ──────────────────────────────────────────────────────────

function _bindEvents() {
  if (!_container) return;

  const sidebar = _container.querySelector('.sidebar');
  if (!sidebar) return;

  // Navigation item clicks (delegated)
  sidebar.addEventListener('click', (e) => {
    // Handle disabled app clicks — show discovery toast
    const disabledItem = e.target.closest('.sidebar-item.disabled');
    if (disabledItem) {
      toast.info('Feature not enabled', 'Enable this feature in Settings → Labs');
      return;
    }

    const item = e.target.closest('.sidebar-item');
    if (item) {
      const id = item.dataset.sidebarId;
      if (id && id !== _activeId) {
        setActiveItem(id);
        _onNavigate?.(id);
      }
      return;
    }

    // "Explore more features" link — exit beginner mode
    const exploreLink = e.target.closest('.sidebar-explore-link');
    if (exploreLink) {
      _exitBeginnerMode();
      return;
    }

    const collapseBtn = e.target.closest('.sidebar-collapse-btn');
    if (collapseBtn) {
      toggleSidebar();
      return;
    }

    // Section header collapse/expand
    const sectionLabel = e.target.closest('.sidebar-section-label[data-section-toggle]');
    if (sectionLabel) {
      const sectionId = sectionLabel.dataset.sectionToggle;
      _toggleSection(sectionId);
      return;
    }
  });

  // Keyboard navigation within the sidebar
  sidebar.addEventListener('keydown', (e) => {
    const items = [...sidebar.querySelectorAll('.sidebar-item')].filter(el => el.offsetHeight > 0);
    const currentIdx = items.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (currentIdx + 1) % items.length;
      items[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (currentIdx - 1 + items.length) % items.length;
      items[prev]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const item = e.target.closest('.sidebar-item');
      if (item) item.click();
    }
  });

  // Tooltip on hover for collapsed mode (delegated)
  sidebar.addEventListener('mouseenter', (e) => {
    if (!_collapsed) return;
    const item = e.target.closest('.sidebar-item, .sidebar-collapse-btn');
    if (item) {
      const label = item.getAttribute('aria-label') || item.querySelector('.sidebar-item-label')?.textContent || '';
      if (label) {
        _showTooltip(label, item.getBoundingClientRect());
      }
    }
  }, true);

  sidebar.addEventListener('mouseleave', (e) => {
    const item = e.target.closest('.sidebar-item, .sidebar-collapse-btn');
    if (item) {
      _hideTooltip();
    }
  }, true);

  // Also hide tooltip when mouse leaves the sidebar entirely
  sidebar.addEventListener('mouseleave', () => {
    _hideTooltip();
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Render the sidebar into a container element.
 *
 * @param {HTMLElement} container — The DOM element to render into
 * @param {object} options
 * @param {function(string): void} options.onNavigate — Called with nav item ID on click
 * @param {string} [options.activeId='home'] — Initially active item ID
 */
export function renderSidebar(container, { onNavigate, activeId = 'home' } = {}) {
  _injectStyles();
  _removeTooltip();

  _container = container;
  _onNavigate = onNavigate || null;
  _activeId = activeId;

  container.innerHTML = _buildHTML();
  _bindEvents();
}

/**
 * Toggle a sidebar section's collapsed state.
 * @private
 * @param {string} sectionId
 */
function _toggleSection(sectionId) {
  const idx = _collapsedSections.indexOf(sectionId);
  if (idx >= 0) {
    _collapsedSections.splice(idx, 1);
  } else {
    _collapsedSections.push(sectionId);
  }
  try { localStorage.setItem('takus_sidebar_sections_collapsed', JSON.stringify(_collapsedSections)); } catch { /* non-critical */ }

  if (!_container) return;

  const section = _container.querySelector(`[data-section="${sectionId}"]`);
  if (!section) return;

  const items = section.querySelector('.sidebar-section-items');
  const chevron = section.querySelector('.sidebar-section-chevron');
  const isNowCollapsed = _collapsedSections.includes(sectionId);

  if (items) {
    if (isNowCollapsed) {
      items.style.maxHeight = items.scrollHeight + 'px';
      requestAnimationFrame(() => {
        items.classList.add('collapsed');
        items.style.maxHeight = '0px';
      });
    } else {
      items.classList.remove('collapsed');
      items.style.maxHeight = items.scrollHeight + 'px';
      // Reset max-height after transition so new items can expand naturally
      items.addEventListener('transitionend', () => {
        if (!_collapsedSections.includes(sectionId)) {
          items.style.maxHeight = '';
        }
      }, { once: true });
    }
  }

  if (chevron) {
    chevron.classList.toggle('rotated', isNowCollapsed);
  }
}

/**
 * Update the active navigation item.
 * Re-renders active/inactive states without full re-render.
 *
 * @param {string} id — The nav item ID to activate
 */
export function setActiveItem(id) {
  _activeId = id;

  if (!_container) return;

  // Update all items
  const items = _container.querySelectorAll('.sidebar-item');
  items.forEach(item => {
    const itemId = item.dataset.sidebarId;
    const isActive = itemId === id;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

/**
 * Returns whether the sidebar is currently in collapsed state.
 *
 * @returns {boolean}
 */
export function isSidebarCollapsed() {
  return _collapsed;
}

/**
 * Toggle the sidebar collapsed/expanded state.
 * Persists the state to localStorage.
 */
export function toggleSidebar() {
  _collapsed = !_collapsed;
  try { localStorage.setItem('takus_sidebar_collapsed', _collapsed ? '1' : '0'); } catch { /* non-critical */ }

  if (!_container) return;

  const sidebar = _container.querySelector('.sidebar');
  if (sidebar) {
    sidebar.classList.toggle('collapsed', _collapsed);
  }

  // Update the collapse button's aria-label
  const collapseBtn = _container.querySelector('.sidebar-collapse-btn');
  if (collapseBtn) {
    collapseBtn.setAttribute('aria-label', _collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    collapseBtn.setAttribute('title', _collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }

  // Update icon sizes for collapsed/expanded
  _updateIconSizes();

  // Hide tooltip when expanding
  if (!_collapsed) {
    _hideTooltip();
  }

  // Dispatch event so other components can react to sidebar state change
  try {
    window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE, {
      detail: { collapsed: _collapsed },
    }));
  } catch { /* non-critical */ }
}

/**
 * Update icon sizes based on collapsed state.
 * @private
 */
function _updateIconSizes() {
  if (!_container) return;

  const iconSize = _collapsed ? 20 : 18;
  const items = _container.querySelectorAll('.sidebar-item');
  const allItems = [...SECTIONS.flatMap(s => s.items), ...BOTTOM_ITEMS];

  items.forEach(item => {
    const itemId = item.dataset.sidebarId;
    const itemDef = allItems.find(i => i.id === itemId);
    if (!itemDef) return;

    const iconFn = icons[itemDef.icon];
    if (!iconFn) return;

    const iconContainer = item.querySelector('.sidebar-item-icon');
    if (iconContainer) {
      iconContainer.innerHTML = iconFn(iconSize);
    }
  });
}

/**
 * Set the sidebar disclosure mode programmatically.
 * @param {'beginner' | 'full'} mode
 */
export function setSidebarDisclosure(mode) {
  if (mode !== 'beginner' && mode !== 'full') return;
  try { localStorage.setItem('sidebar_disclosure', mode); } catch { /* non-critical */ }
  if (_container && _onNavigate !== undefined) {
    renderSidebar(_container, { onNavigate: _onNavigate, activeId: _activeId });
  }
}

/**
 * Returns whether the sidebar is currently in beginner (simplified) mode.
 * @returns {boolean}
 */
export function isBeginnerMode() {
  return _isBeginnerMode();
}
