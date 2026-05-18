// Takus — Quick Actions Bar
// Renders dynamic quick actions contributed by active apps.
// Each app owns its actions: Recorder → Record, Drive → Upload, etc.

import { icons } from '../lib/icons.js';
import { isScreenCaptureSupported } from '../lib/utils.js';

// Icon resolver — maps app-contributed icon keys to SVG functions
const ICON_MAP = {
  record: null,  // Special: rendered as the record-btn circle
  upload: (s) => icons.upload(s),
  calendar: (s) => icons.calendar(s),
  cloud: (s) => icons.cloud(s),
  zap: (s) => icons.zap(s),
  search: (s) => icons.search(s),
  plus: (s) => icons.plus(s),
  email: (s) => icons.mail?.(s) || '📧',
};

/**
 * Render the Quick Actions bar into a container.
 * Primary actions get hero treatment (record-btn style).
 * Secondary actions get ghost-button style.
 *
 * @param {HTMLElement} container
 * @param {Array<{id, label, icon, primary, handler, appId}>} actions
 * @param {object} [opts] - { shortcuts }
 */
export function renderQuickActions(container, actions, opts = {}) {
  const canRecord = isScreenCaptureSupported();
  const shortcuts = opts.shortcuts || {};

  if (!actions.length) {
    container.innerHTML = '';
    return;
  }

  // Sort actions by order field (lower = higher priority)
  const sorted = [...actions].sort((a, b) => (a.order || 99) - (b.order || 99));

  const primaryActions = sorted.filter(a => a.primary);
  const secondaryActions = sorted.filter(a => !a.primary);

  // Render primary actions (hero treatment)
  const primaryHTML = primaryActions.map(action => {
    if (action.icon === 'record') {
      // Special: Record button gets the iconic red circle
      if (!canRecord) {
        return `
          <button class="record-btn" disabled title="Screen entry requires a desktop browser" aria-label="Screen entry not supported" style="opacity:0.3;cursor:not-allowed;">
            <div class="record-icon"></div>
          </button>`;
      }
      const shortcutKey = shortcuts.record === ' ' ? 'Space' : (shortcuts.record || 'R').toUpperCase();
      return `
        <button class="record-btn" data-quick-action="${action.appId}:${action.id}" title="Start Recording (${shortcutKey})" aria-label="Start entry">
          <div class="record-icon"></div>
        </button>`;
    }

    // Other primary actions get gradient button
    const iconFn = ICON_MAP[action.icon];
    const iconHtml = iconFn ? iconFn(18) : action.icon;
    return `
      <button class="btn btn-primary btn-lg" data-quick-action="${action.appId}:${action.id}" title="${action.label}" aria-label="${action.label}">
        ${iconHtml} ${action.label}
      </button>`;
  }).join('');

  // Render secondary actions (compact ghost buttons)
  const secondaryHTML = secondaryActions.map(action => {
    const iconFn = ICON_MAP[action.icon];
    const iconHtml = iconFn ? iconFn(16) : action.icon;
    return `
      <button class="btn btn-ghost btn-sm" data-quick-action="${action.appId}:${action.id}" title="${action.label}" aria-label="${action.label}" style="display:flex;align-items:center;gap:4px;">
        ${iconHtml}
        <span style="font-size:var(--font-xs);">${action.label}</span>
      </button>`;
  }).join('');

  // Build the hint text
  let hintHTML = '';
  if (canRecord) {
    const shortcutKey = shortcuts.record === ' ' ? 'Space' : (shortcuts.record || 'R').toUpperCase();
    hintHTML = `
      <p style="font-size:var(--font-sm);color:var(--color-text-muted);">
        Press <kbd style="background:var(--color-bg-elevated);padding:2px 6px;border-radius:4px;font-size:var(--font-xs);">${shortcutKey}</kbd> to record &nbsp;·&nbsp; <kbd style="background:var(--color-bg-elevated);padding:2px 6px;border-radius:4px;font-size:var(--font-xs);">,</kbd> for settings
      </p>`;
  } else if (primaryActions.some(a => a.icon === 'record')) {
    hintHTML = `<p style="font-size:var(--font-sm);color:var(--color-text-muted);">Screen entry requires a desktop browser (Chrome, Edge, or Firefox)</p>`;
  }

  container.innerHTML = `
    <div class="card animate-in" style="text-align:center;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-4);">
        <div style="display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap;justify-content:center;">
          ${secondaryHTML}
          ${primaryHTML}
        </div>
        ${hintHTML}
      </div>
    </div>`;

  // Bind click handlers
  const actionMap = new Map(actions.map(a => [`${a.appId}:${a.id}`, a]));
  container.querySelectorAll('[data-quick-action]').forEach(btn => {
    const key = btn.dataset.quickAction;
    const action = actionMap.get(key);
    if (action && typeof action.handler === 'function') {
      btn.addEventListener('click', () => action.handler());
    }
  });
}
