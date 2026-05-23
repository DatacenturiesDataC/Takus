// Takus — Sidebar Navigation
// Collapsible sidebar inspired by Linear/Notion.
// Vertical nav with grouped sections, icon-only collapsed mode,
// and persistent state via localStorage.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';

// ── State ──────────────────────────────────────────────────────────────────

let _collapsed = localStorage.getItem('takus_sidebar_collapsed') === '1';
let _activeId = 'home';
let _onNavigate = null;
let _container = null;

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
      { id: 'history', label: 'Library', icon: 'bookOpen' },
      { id: 'ask', label: 'Ask', icon: 'messageSquare' },
      { id: 'documents', label: 'Documents', icon: 'edit' },
    ],
  },
  {
    id: 'productivity',
    label: 'Productivity',
    items: [
      { id: 'tasks', label: 'Tasks', icon: 'checkSquare' },
      { id: 'goals', label: 'Goals', icon: 'flag' },
      { id: 'calendar', label: 'Calendar', icon: 'calendar' },
      { id: 'inbox', label: 'Inbox', icon: 'inbox' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { id: 'people', label: 'People', icon: 'users' },
      { id: 'chat', label: 'Chat', icon: 'send' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'insights', label: 'Insights', icon: 'barChart' },
      { id: 'drive', label: 'Drive', icon: 'cloud' },
      { id: 'integrations', label: 'Integrations', icon: 'link' },
      { id: 'archive', label: 'Archive', icon: 'package' },
    ],
  },
];

const BOTTOM_ITEMS = [
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'feedback', label: 'Feedback', icon: 'flag' },
];

// ── Style Injection ────────────────────────────────────────────────────────

let _stylesInjected = false;

function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'takus-sidebar-styles';
  style.textContent = `
/* ── Sidebar Layout ─────────────────────────────────────────────────────── */

.sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
  width: 240px;
  display: flex;
  flex-direction: column;
  background: var(--color-surface, #ffffff);
  border-right: 1px solid var(--color-border, #e2e4e9);
  transition: width 150ms ease;
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  user-select: none;
  -webkit-user-select: none;
}

.sidebar.collapsed {
  width: 56px;
}

/* ── Brand Area ─────────────────────────────────────────────────────────── */

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 12px;
  min-height: 48px;
  flex-shrink: 0;
  overflow: hidden;
}

.sidebar-brand-logo {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--color-accent, #7c3aed);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  line-height: 1;
}

.sidebar-brand-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, #1a1a2e);
  white-space: nowrap;
  overflow: hidden;
  opacity: 1;
  transition: opacity 150ms ease;
}

.sidebar.collapsed .sidebar-brand-text {
  opacity: 0;
  width: 0;
  pointer-events: none;
}

.sidebar.collapsed .sidebar-brand {
  padding: 16px 16px 12px;
  justify-content: center;
}

/* ── Workspace Badge ────────────────────────────────────────────────────── */

.sidebar-workspace {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--color-surface-elevated, rgba(0, 0, 0, 0.03));
  overflow: hidden;
  transition: opacity 150ms ease;
}

.sidebar.collapsed .sidebar-workspace {
  opacity: 0;
  height: 0;
  margin: 0;
  padding: 0;
  pointer-events: none;
}

.sidebar-workspace-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-success, #22c55e);
  flex-shrink: 0;
}

.sidebar-workspace-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Scroll Region ──────────────────────────────────────────────────────── */

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.1) transparent;
}

.sidebar-nav::-webkit-scrollbar {
  width: 4px;
}

.sidebar-nav::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-nav::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
}

/* ── Section ────────────────────────────────────────────────────────────── */

.sidebar-section {
  padding: 4px 0;
}

.sidebar-section + .sidebar-section {
  margin-top: 4px;
}

.sidebar-section-label {
  padding: 8px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  opacity: 1;
  transition: opacity 150ms ease;
}

.sidebar.collapsed .sidebar-section-label {
  opacity: 0;
  height: 0;
  padding: 0;
  margin: 0;
  pointer-events: none;
  overflow: hidden;
}

/* ── Nav Item ───────────────────────────────────────────────────────────── */

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  margin: 1px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-secondary, #64748b);
  text-decoration: none;
  position: relative;
  white-space: nowrap;
  overflow: hidden;
  border: none;
  background: none;
  width: calc(100% - 16px);
  text-align: left;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  transition: background 150ms ease, color 150ms ease;
  outline: none;
}

.sidebar-item:hover {
  background: var(--color-surface-hover, rgba(0, 0, 0, 0.04));
  color: var(--color-text-primary, #1a1a2e);
}

.sidebar-item:focus-visible {
  box-shadow: 0 0 0 2px var(--color-accent, #7c3aed);
}

.sidebar-item.active {
  background: var(--color-accent-subtle, rgba(124, 58, 237, 0.08));
  color: var(--color-accent, #7c3aed);
}

.sidebar-item.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--color-accent, #7c3aed);
}

.sidebar-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}

.sidebar-item-icon svg {
  display: block;
}

.sidebar-item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 1;
  transition: opacity 150ms ease;
}

.sidebar.collapsed .sidebar-item-label {
  opacity: 0;
  width: 0;
  pointer-events: none;
}

.sidebar.collapsed .sidebar-item {
  justify-content: center;
  padding: 8px;
  margin: 1px 8px;
  width: calc(100% - 16px);
}

.sidebar.collapsed .sidebar-item.active::before {
  left: -8px;
  top: 6px;
  bottom: 6px;
}

/* ── Tooltip (collapsed mode) ───────────────────────────────────────────── */

.sidebar-tooltip {
  position: fixed;
  left: 64px;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--color-tooltip-bg, #1a1a2e);
  color: var(--color-tooltip-text, #fff);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1000;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 120ms ease, transform 120ms ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.sidebar-tooltip.visible {
  opacity: 1;
  transform: translateX(0);
}

/* ── Divider ────────────────────────────────────────────────────────────── */

.sidebar-divider {
  height: 1px;
  margin: 4px 16px;
  background: var(--color-border, #e2e4e9);
}

.sidebar.collapsed .sidebar-divider {
  margin: 4px 12px;
}

/* ── Bottom Section ─────────────────────────────────────────────────────── */

.sidebar-bottom {
  flex-shrink: 0;
  border-top: 1px solid var(--color-border, #e2e4e9);
  padding: 8px 0;
}

/* ── Collapse Toggle ────────────────────────────────────────────────────── */

.sidebar-collapse-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  margin: 1px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-tertiary, #94a3b8);
  border: none;
  background: none;
  width: calc(100% - 16px);
  text-align: left;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  transition: background 150ms ease, color 150ms ease;
  outline: none;
}

.sidebar-collapse-btn:hover {
  background: var(--color-surface-hover, rgba(0, 0, 0, 0.04));
  color: var(--color-text-secondary, #64748b);
}

.sidebar-collapse-btn:focus-visible {
  box-shadow: 0 0 0 2px var(--color-accent, #7c3aed);
}

.sidebar-collapse-btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  transition: transform 150ms ease;
}

.sidebar.collapsed .sidebar-collapse-btn {
  justify-content: center;
  padding: 8px;
}

.sidebar.collapsed .sidebar-collapse-btn-icon {
  transform: rotate(180deg);
}

.sidebar-collapse-btn-label {
  opacity: 1;
  transition: opacity 150ms ease;
}

.sidebar.collapsed .sidebar-collapse-btn-label {
  opacity: 0;
  width: 0;
  pointer-events: none;
}

/* ── Dark Mode Overrides ────────────────────────────────────────────────── */

@media (prefers-color-scheme: dark) {
  .sidebar {
    background: var(--color-surface, #0f0f14);
    border-right-color: var(--color-border, rgba(255, 255, 255, 0.08));
  }

  .sidebar-workspace {
    background: var(--color-surface-elevated, rgba(255, 255, 255, 0.04));
  }

  .sidebar-item:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.06));
  }

  .sidebar-item.active {
    background: var(--color-accent-subtle, rgba(139, 92, 246, 0.12));
    color: var(--color-accent, #8b5cf6);
  }

  .sidebar-item.active::before {
    background: var(--color-accent, #8b5cf6);
  }

  .sidebar-section-label {
    color: var(--color-text-tertiary, rgba(255, 255, 255, 0.35));
  }

  .sidebar-divider {
    background: var(--color-border, rgba(255, 255, 255, 0.08));
  }

  .sidebar-bottom {
    border-top-color: var(--color-border, rgba(255, 255, 255, 0.08));
  }

  .sidebar-tooltip {
    background: var(--color-tooltip-bg, #2a2a35);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  }

  .sidebar-nav::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
  }

  .sidebar-collapse-btn:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.06));
  }
}
`;
  document.head.appendChild(style);
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

function _renderSectionHTML(section) {
  const labelHTML = section.label
    ? `<div class="sidebar-section-label">${esc(section.label)}</div>`
    : '';

  const itemsHTML = section.items
    .map(item => _renderItemHTML(item, item.id === _activeId))
    .join('\n');

  return `<div class="sidebar-section" data-section="${esc(section.id)}">
    ${labelHTML}
    ${itemsHTML}
  </div>`;
}

function _buildHTML() {
  const collapsedClass = _collapsed ? ' collapsed' : '';
  const iconSize = _collapsed ? 20 : 18;

  const sectionsHTML = SECTIONS.map(s => _renderSectionHTML(s)).join('\n<div class="sidebar-divider"></div>\n');

  const bottomItemsHTML = BOTTOM_ITEMS
    .map(item => _renderItemHTML(item, item.id === _activeId))
    .join('\n');

  const collapseIcon = icons.chevronLeft ? icons.chevronLeft(16) : '‹';

  return `<aside class="sidebar${collapsedClass}" role="navigation" aria-label="Main navigation">
  <div class="sidebar-brand">
    <div class="sidebar-brand-logo" aria-hidden="true">T</div>
    <span class="sidebar-brand-text">Takus</span>
  </div>

  <nav class="sidebar-nav" role="tablist" aria-label="App navigation">
    ${sectionsHTML}
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
    const item = e.target.closest('.sidebar-item');
    if (item) {
      const id = item.dataset.sidebarId;
      if (id && id !== _activeId) {
        setActiveItem(id);
        _onNavigate?.(id);
      }
      return;
    }

    const collapseBtn = e.target.closest('.sidebar-collapse-btn');
    if (collapseBtn) {
      toggleSidebar();
      return;
    }
  });

  // Keyboard navigation within the sidebar
  sidebar.addEventListener('keydown', (e) => {
    const items = [...sidebar.querySelectorAll('.sidebar-item')];
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

  _container = container;
  _onNavigate = onNavigate || null;
  _activeId = activeId;

  container.innerHTML = _buildHTML();
  _bindEvents();
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
  localStorage.setItem('takus_sidebar_collapsed', _collapsed ? '1' : '0');

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
    window.dispatchEvent(new CustomEvent('takus:sidebar-toggle', {
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

  items.forEach(item => {
    const itemId = item.dataset.sidebarId;
    const allItems = [...SECTIONS.flatMap(s => s.items), ...BOTTOM_ITEMS];
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
