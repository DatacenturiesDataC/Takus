// Takus — Notification Manager (Knowledge OS: Communication Layer)
// Priority-aware notification system that replaces scattered toast calls
// with intelligent, contextual alerts from the autonomy engine and UI.
//
// Three tiers:
//   1. Ephemeral (toast)     — "Entry saved" — auto-dismisses
//   2. Persistent (banner)   — "3 pending tasks" — stays until dismissed
//   3. Actionable (card)     — "Meeting in 15 min" — has buttons
//
// The notification manager is the public API that both the UI and
// the autonomy engine use to communicate with the user.
//
// NOTE: This module lives in lib/ and must NOT import from components/.
// Ephemeral notifications are dispatched as DOM events; app-shell
// subscribes and routes them to toast.js for rendering.

import { NOTIFY } from './events.js';
import { shouldNotify } from './notification-prefs.js';

// ── State ────────────────────────────────────────────────────────────────────

/** @type {Array<{id: string, type: string, title: string, body: string, priority: number, actions?: Array, dismissedAt?: number, createdAt: number}>} */
let _notifications = [];
let _listeners = [];
let _idCounter = 0;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Show an ephemeral notification (auto-dismissing toast).
 * Dispatches a DOM event that the UI layer (app-shell) catches and renders.
 * @param {string} title
 * @param {string} body
 * @param {'info'|'success'|'warning'|'error'} level
 * @param {object} [options]
 * @param {string} [options.category] - Notification category for prefs filtering
 */
export async function notifyEphemeral(title, body, level = 'info', options = {}) {
  // Check notification preferences (Phase 62)
  const category = options.category || _inferCategory(title, body);
  const severity = level === 'error' ? 'error' : level === 'warning' ? 'important' : 'info';
  const allowed = await shouldNotify(category, severity).catch(() => true);
  if (!allowed) return;

  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent(NOTIFY, {
      detail: { title, body, level },
    }));
  }
  _emit('ephemeral', { title, body, level });
}

/**
 * Show a persistent notification (stays until dismissed).
 * @param {string} title
 * @param {string} body
 * @param {object} [options]
 * @param {string} [options.id] - Unique ID (prevents duplicates)
 * @param {number} [options.priority] - 0=low, 1=normal, 2=high, 3=urgent
 * @param {string} [options.icon] - HTML icon string
 * @returns {string} Notification ID
 */
export function notifyPersistent(title, body, options = {}) {
  const id = options.id || `notif_${++_idCounter}`;

  // Deduplicate by ID
  if (options.id && _notifications.find(n => n.id === id && !n.dismissedAt)) {
    return id;
  }

  const notif = {
    id,
    type: 'persistent',
    title,
    body,
    priority: options.priority ?? 1,
    icon: options.icon || '',
    createdAt: Date.now(),
    dismissedAt: null,
  };

  _notifications.push(notif);
  _emit('added', notif);
  _renderBanner();
  return id;
}

/**
 * Show an actionable notification with buttons.
 * @param {string} title
 * @param {string} body
 * @param {Array<{label: string, action: function, primary?: boolean}>} actions
 * @param {object} [options]
 * @returns {string} Notification ID
 */
export function notifyActionable(title, body, actions = [], options = {}) {
  const id = options.id || `notif_${++_idCounter}`;

  if (options.id && _notifications.find(n => n.id === id && !n.dismissedAt)) {
    return id;
  }

  const notif = {
    id,
    type: 'actionable',
    title,
    body,
    actions,
    priority: options.priority ?? 2,
    icon: options.icon || '',
    createdAt: Date.now(),
    dismissedAt: null,
  };

  _notifications.push(notif);
  _emit('added', notif);
  _renderBanner();
  return id;
}

/**
 * Dismiss a notification by ID.
 * @param {string} id
 */
export function dismissNotification(id) {
  const notif = _notifications.find(n => n.id === id);
  if (notif) {
    notif.dismissedAt = Date.now();
    _emit('dismissed', notif);
    _renderBanner();

    // Auto-prune dismissed notifications to bound memory in long sessions
    const dismissedCount = _notifications.filter(n => n.dismissedAt).length;
    if (dismissedCount > 50) pruneNotifications();
  }
}

/**
 * Get all active (undismissed) notifications.
 * @returns {Array}
 */
export function getActiveNotifications() {
  return _notifications
    .filter(n => !n.dismissedAt)
    .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
}

/**
 * Subscribe to notification events.
 * @param {function(string, object): void} fn
 * @returns {function} Unsubscribe
 */
export function onNotification(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

/**
 * Clear all dismissed notifications from memory.
 */
export function pruneNotifications() {
  _notifications = _notifications.filter(n => !n.dismissedAt);
}

// ── Banner Renderer ──────────────────────────────────────────────────────────

function _renderBanner() {
  const existing = document.getElementById('notif-banner-container');
  if (existing) existing.remove();

  const active = getActiveNotifications();
  if (active.length === 0) return;

  const container = document.createElement('div');
  container.id = 'notif-banner-container';
  container.style.cssText = [
    'position:fixed;top:var(--space-3);left:50%;transform:translateX(-50%);',
    'z-index:var(--z-toast);',
    'display:flex;flex-direction:column;gap:var(--space-2);',
    'width:min(420px,calc(100vw - 32px));',
    'pointer-events:none;',
  ].join('');

  for (const notif of active.slice(0, 3)) {
    const banner = document.createElement('div');
    banner.style.cssText = [
      'pointer-events:auto;',
      'background:var(--color-bg-card);',
      'border:1px solid rgba(255,255,255,0.08);',
      'border-radius:var(--radius-md);',
      'padding:var(--space-3) var(--space-4);',
      'box-shadow:0 8px 32px rgba(0,0,0,0.4);',
      'animation:slide-up 0.2s ease-out;',
      'display:flex;flex-direction:column;gap:var(--space-2);',
    ].join('');

    let html = `
      <div style="display:flex;align-items:center;gap:var(--space-2);">
        ${notif.icon ? `<span style="flex-shrink:0;">${notif.icon}</span>` : ''}
        <span style="flex:1;font-size:var(--font-sm);font-weight:var(--weight-semi);color:var(--color-text-primary);">${_esc(notif.title)}</span>
        <button data-dismiss="${notif.id}" style="background:none;border:none;cursor:pointer;color:var(--color-text-muted);font-size:14px;padding:2px;" title="Dismiss">✕</button>
      </div>`;

    if (notif.body) {
      html += `<div style="font-size:var(--font-xs);color:var(--color-text-secondary);">${_esc(notif.body)}</div>`;
    }

    if (notif.actions?.length) {
      html += `<div style="display:flex;gap:var(--space-2);margin-top:var(--space-1);">`;
      for (let i = 0; i < notif.actions.length; i++) {
        const act = notif.actions[i];
        const isPrimary = act.primary;
        html += `<button data-action="${notif.id}:${i}" style="
          font-size:var(--font-xs);padding:var(--space-1) var(--space-3);
          border-radius:var(--radius-sm);border:1px solid ${isPrimary ? 'var(--color-primary)' : 'rgba(255,255,255,0.1)'};
          background:${isPrimary ? 'var(--color-primary)' : 'transparent'};
          color:${isPrimary ? '#fff' : 'var(--color-text-secondary)'};
          cursor:pointer;font-weight:var(--weight-medium);
          transition:opacity 0.15s;
        ">${_esc(act.label)}</button>`;
      }
      html += '</div>';
    }

    banner.innerHTML = html;
    container.appendChild(banner);
  }

  document.body.appendChild(container);

  // Event delegation
  container.addEventListener('click', (e) => {
    const dismissBtn = e.target.closest('[data-dismiss]');
    if (dismissBtn) {
      dismissNotification(dismissBtn.dataset.dismiss);
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const [nid, idx] = actionBtn.dataset.action.split(':');
      const notif = _notifications.find(n => n.id === nid);
      const action = notif?.actions?.[parseInt(idx, 10)];
      if (action?.action) {
        action.action();
        dismissNotification(nid);
      }
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _emit(type, data) {
  for (const fn of _listeners) {
    try { fn(type, data); } catch {}
  }
}

function _esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

/**
 * Infer notification category from content for prefs filtering.
 * Falls back to 'system' if no category is detected.
 */
function _inferCategory(title, body) {
  const text = `${title} ${body}`.toLowerCase();
  if (text.includes('upload') || text.includes('converting')) return 'uploads';
  if (text.includes('task') || text.includes('assigned')) return 'tasks';
  if (text.includes('goal')) return 'goals';
  if (text.includes('break') || text.includes('working for')) return 'breaks';
  if (text.includes('calendar') || text.includes('meeting')) return 'calendar';
  if (text.includes('approval') || text.includes('approve')) return 'approvals';
  return 'system';
}
