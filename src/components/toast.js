// Takus — Toast Notification System
import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';

let container = null;

function ensureContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
  }
  return container;
}

const iconMap = {
  success: () => `<span class="toast-icon" style="color:var(--color-success)">${icons.check(18)}</span>`,
  error:   () => `<span class="toast-icon" style="color:var(--color-danger)">${icons.x(18)}</span>`,
  warning: () => `<span class="toast-icon" style="color:var(--color-warning)">${icons.alertTriangle(18)}</span>`,
  info:    () => `<span class="toast-icon" style="color:var(--color-info)">${icons.info(18)}</span>`,
};



// Track recent toasts for deduplication (title → { element, count, timer })
const _recentToasts = new Map();
const DEDUP_WINDOW_MS = 2000;

export function showToast(title, message = '', type = 'info', duration = 5000, opts = {}) {
  const c = ensureContainer();

  // Deduplicate: if the same title fired recently, update count badge
  const dedupKey = `${type}::${title}`;
  const existing = _recentToasts.get(dedupKey);
  if (existing && existing.element.parentNode) {
    existing.count++;
    const badge = existing.element.querySelector('.toast-dedup-badge');
    if (badge) {
      badge.textContent = `×${existing.count}`;
    } else {
      const b = document.createElement('span');
      b.className = 'toast-dedup-badge';
      b.style.cssText = 'font-size:var(--text-2xs);font-weight:700;color:rgba(255,255,255,0.6);background:rgba(255,255,255,0.1);padding:1px 6px;border-radius:10px;margin-left:auto;flex-shrink:0;';
      b.textContent = `×${existing.count}`;
      existing.element.querySelector('.toast-body')?.appendChild(b);
    }
    // Update message to latest
    if (message) {
      let msgEl = existing.element.querySelector('.toast-msg');
      if (!msgEl) {
        msgEl = document.createElement('div');
        msgEl.className = 'toast-msg';
        existing.element.querySelector('.toast-body')?.appendChild(msgEl);
      }
      msgEl.innerHTML = esc(message);
    }
    // Reset the dismiss timer
    clearTimeout(existing.timer);
    existing.timer = duration > 0 ? setTimeout(() => dismiss(existing.element), duration) : null;
    return existing.element;
  }

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    ${iconMap[type]?.() || ''}
    <div class="toast-body">
      <div class="toast-title">${esc(title)}</div>
      ${message ? `<div class="toast-msg">${esc(message)}</div>` : ''}
    </div>
    <span class="toast-close">${icons.x(14)}</span>
  `;

  // Action button (e.g. "View & Edit" on auto-save toast)
  if (opts.action?.label) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = opts.action.label;
    btn.style.cssText = 'background:none;border:1px solid rgba(255,255,255,0.3);color:#fff;padding:3px 10px;border-radius:6px;font-size:var(--text-xs);font-weight:600;cursor:pointer;margin-left:8px;flex-shrink:0;white-space:nowrap;';
    btn.addEventListener('click', () => { dismiss(el); opts.action.onClick?.(); });
    el.querySelector('.toast-body').appendChild(btn);
  }

  el.querySelector('.toast-close').addEventListener('click', () => dismiss(el));
  c.appendChild(el);

  // Limit max visible toasts to prevent screen flooding
  const MAX_TOASTS = 5;
  while (c.children.length > MAX_TOASTS) {
    dismiss(c.children[0]);
  }

  const timer = duration > 0 ? setTimeout(() => dismiss(el), duration) : null;

  // Track for deduplication
  _recentToasts.set(dedupKey, { element: el, count: 1, timer });
  setTimeout(() => _recentToasts.delete(dedupKey), DEDUP_WINDOW_MS + duration);

  return el;
}

function dismiss(el) {
  if (!el.parentNode) return; // Already removed
  el.classList.add('removing');
  const remove = () => { if (el.parentNode) el.remove(); };
  el.addEventListener('animationend', remove, { once: true });
  // Fallback: if animationend never fires (prefers-reduced-motion), force remove
  setTimeout(remove, 500);
}

// Convenience methods
export const toast = {
  success: (t, m, opts) => showToast(t, m, 'success', 5000, opts),
  error:   (t, m, opts) => showToast(t, m, 'error', 12000, opts),
  warning: (t, m, opts) => showToast(t, m, 'warning', 5000, opts),
  info:    (t, m, opts) => showToast(t, m, 'info', 5000, opts),
};
