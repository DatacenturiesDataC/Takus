// Takus — Shared Dialog Utilities
// Non-blocking async replacements for native prompt() and confirm().
// Uses native HTML <dialog> for accessibility (focus trapping, Esc close, backdrop).

import { esc } from './utils.js';

/** Focusable element selector for keyboard trapping */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap keyboard focus within a container element.
 * Returns a cleanup function to remove the listener.
 *
 * @param {HTMLElement} container  The modal/overlay to trap focus within
 * @returns {function} cleanup — call to remove the keydown listener
 */
export function trapFocus(container) {
  function handler(e) {
    if (e.key !== 'Tab') return;
    const focusable = [...container.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

/**
 * Show a non-blocking text prompt dialog.
 * Returns the entered text, or null if cancelled.
 *
 * @param {string} message  Label shown above the input
 * @param {string} [placeholder='']  Input placeholder text
 * @returns {Promise<string|null>}
 */
export function promptAsync(message, placeholder = '') {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'takus-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="takus-dialog-form">
        <label for="takus-dlg-input" class="takus-dialog-label">${esc(message)}</label>
        <input type="text" id="takus-dlg-input" class="input" placeholder="${esc(placeholder)}" autocomplete="off" autofocus aria-label="${esc(message)}" />
        <div class="takus-dialog-actions">
          <button type="button" class="btn btn-ghost" id="takus-dlg-cancel" aria-label="Cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" value="ok" aria-label="Submit">Submit</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    const input = dialog.querySelector('#takus-dlg-input');
    const cleanup = trapFocus(dialog);
    dialog.addEventListener('close', () => {
      cleanup();
      resolve(dialog.returnValue === 'ok' ? input.value : null);
      dialog.remove();
    });
    dialog.querySelector('#takus-dlg-cancel').addEventListener('click', () => dialog.close('cancel'));
    dialog.showModal();
  });
}

/**
 * Show a non-blocking multi-line text prompt dialog with a textarea.
 * Ideal for pasting longer content (documents, notes, etc.).
 * Returns the entered text, or null if cancelled.
 *
 * @param {string} message  Label shown above the textarea
 * @param {string} [placeholder='']  Textarea placeholder text
 * @returns {Promise<string|null>}
 */
export function promptAreaAsync(message, placeholder = '') {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'takus-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="takus-dialog-form">
        <label for="takus-dlg-area" class="takus-dialog-label">${esc(message)}</label>
        <textarea id="takus-dlg-area" class="input" placeholder="${esc(placeholder)}" rows="6" autofocus aria-label="${esc(message)}" style="resize:vertical;min-height:80px;font-family:inherit;font-size:var(--font-sm);line-height:1.5;"></textarea>
        <div class="takus-dialog-actions">
          <button type="button" class="btn btn-ghost" id="takus-dlg-cancel" aria-label="Cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" value="ok" aria-label="Submit">Submit</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    const area = dialog.querySelector('#takus-dlg-area');
    const cleanup = trapFocus(dialog);
    dialog.addEventListener('close', () => {
      cleanup();
      resolve(dialog.returnValue === 'ok' ? area.value : null);
      dialog.remove();
    });
    dialog.querySelector('#takus-dlg-cancel').addEventListener('click', () => dialog.close('cancel'));
    dialog.showModal();
  });
}

/**
 * Show a non-blocking confirmation dialog.
 * Returns true if confirmed, false if cancelled.
 *
 * @param {string} message    Question or warning text
 * @param {object} [opts]
 * @param {string} [opts.confirmLabel='Confirm']  Label for the confirm button
 * @param {boolean} [opts.destructive=false]  Style the confirm button as destructive (red)
 * @returns {Promise<boolean>}
 */
export function confirmAsync(message, { confirmLabel = 'Confirm', destructive = false } = {}) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'takus-dialog';
    const btnStyle = destructive
      ? 'background:var(--color-error, #ef4444);color:#fff;border:none;'
      : '';
    dialog.innerHTML = `
      <form method="dialog" class="takus-dialog-form">
        <p class="takus-dialog-label">${esc(message)}</p>
        <div class="takus-dialog-actions">
          <button type="button" class="btn btn-ghost" id="takus-dlg-cancel" aria-label="Cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" value="ok" style="${btnStyle}" aria-label="${esc(confirmLabel)}">${esc(confirmLabel)}</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    const cleanup = trapFocus(dialog);
    dialog.addEventListener('close', () => {
      cleanup();
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    dialog.querySelector('#takus-dlg-cancel').addEventListener('click', () => dialog.close('cancel'));
    dialog.showModal();
  });
}

/**
 * Show a non-blocking select/dropdown dialog.
 * Returns the selected value, or null if cancelled.
 *
 * @param {string} message  Label shown above the select
 * @param {string[]} values  Option values
 * @param {string[]} labels  Option display labels (same length as values)
 * @param {string} [currentValue='']  Currently selected value
 * @returns {Promise<string|null>}
 */
export function selectAsync(message, values, labels, currentValue = '') {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'takus-dialog';
    const options = values.map((v, i) =>
      `<option value="${esc(v)}" ${v === currentValue ? 'selected' : ''}>${esc(labels[i])}</option>`
    ).join('');
    dialog.innerHTML = `
      <form method="dialog" class="takus-dialog-form">
        <label for="takus-dlg-select" class="takus-dialog-label">${esc(message)}</label>
        <select id="takus-dlg-select" class="input" autofocus style="padding:6px 10px;" aria-label="${esc(message)}">${options}</select>
        <div class="takus-dialog-actions">
          <button type="button" class="btn btn-ghost" id="takus-dlg-cancel" aria-label="Cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" value="ok" aria-label="Apply">Apply</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    const select = dialog.querySelector('#takus-dlg-select');
    const cleanup = trapFocus(dialog);
    dialog.addEventListener('close', () => {
      cleanup();
      resolve(dialog.returnValue === 'ok' ? select.value : null);
      dialog.remove();
    });
    dialog.querySelector('#takus-dlg-cancel').addEventListener('click', () => dialog.close('cancel'));
    dialog.showModal();
  });
}
