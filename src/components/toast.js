// Takus — Toast Notification System
import { icons } from '../lib/icons.js';

let container = null;

function ensureContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
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

/** Escape HTML to prevent XSS from error messages injected as innerHTML. */
function escHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

export function showToast(title, message = '', type = 'info', duration = 5000) {
  const c = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    ${iconMap[type]?.() || ''}
    <div class="toast-body">
      <div class="toast-title">${escHtml(title)}</div>
      ${message ? `<div class="toast-msg">${escHtml(message)}</div>` : ''}
    </div>
    <span class="toast-close">${icons.x(14)}</span>
  `;

  el.querySelector('.toast-close').addEventListener('click', () => dismiss(el));
  c.appendChild(el);

  // Limit max visible toasts to prevent screen flooding
  const MAX_TOASTS = 5;
  while (c.children.length > MAX_TOASTS) {
    dismiss(c.children[0]);
  }

  if (duration > 0) {
    setTimeout(() => dismiss(el), duration);
  }

  return el;
}

function dismiss(el) {
  el.classList.add('removing');
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

// Convenience methods
export const toast = {
  success: (t, m) => showToast(t, m, 'success'),
  error:   (t, m) => showToast(t, m, 'error', 8000),
  warning: (t, m) => showToast(t, m, 'warning'),
  info:    (t, m) => showToast(t, m, 'info'),
};
