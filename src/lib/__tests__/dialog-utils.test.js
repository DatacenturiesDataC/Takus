// Takus — Dialog Utils Tests
// Tests for the async dialog utilities (prompt, confirm, select).
// JSDOM does not implement HTMLDialogElement.showModal(), so we polyfill it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { trapFocus, promptAsync, promptAreaAsync, confirmAsync, selectAsync } from '../dialog-utils.js';

// ── JSDOM polyfill for <dialog>.showModal() ──────────────────────────────
beforeEach(() => {
  // JSDOM does not support showModal/close on <dialog>
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    const origClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.close = function (returnValue) {
      this.returnValue = returnValue || '';
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
});

afterEach(() => {
  // Clean up any leftover dialogs
  document.querySelectorAll('dialog').forEach(d => d.remove());
});

// ── trapFocus ────────────────────────────────────────────────────────────

describe('trapFocus', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <button id="btn1">First</button>
      <input id="input1" />
      <button id="btn2">Last</button>
    `;
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('returns a cleanup function', () => {
    const cleanup = trapFocus(container);
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('does nothing for non-Tab keys', () => {
    trapFocus(container);
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    const spy = vi.spyOn(event, 'preventDefault');
    container.dispatchEvent(event);
    expect(spy).not.toHaveBeenCalled();
  });

  it('cleanup removes the listener (no error on Tab after cleanup)', () => {
    const cleanup = trapFocus(container);
    cleanup();
    // After cleanup, Tab dispatch should not throw
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    expect(() => container.dispatchEvent(event)).not.toThrow();
  });
});

// ── promptAsync ──────────────────────────────────────────────────────────

describe('promptAsync', () => {
  it('creates a <dialog> element with correct structure', async () => {
    const promise = promptAsync('Enter name', 'Your name');

    const dialog = document.querySelector('dialog.takus-dialog');
    expect(dialog).toBeTruthy();

    const input = dialog.querySelector('#takus-dlg-input');
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe('Your name');

    const label = dialog.querySelector('.takus-dialog-label');
    expect(label.textContent).toContain('Enter name');

    // Simulate cancel
    dialog.close('cancel');
    const result = await promise;
    expect(result).toBeNull();
  });

  it('returns null when cancelled via cancel button', async () => {
    const promise = promptAsync('Test');
    const dialog = document.querySelector('dialog.takus-dialog');
    dialog.querySelector('#takus-dlg-cancel').click();
    expect(await promise).toBeNull();
  });

  it('escapes XSS in message', async () => {
    const promise = promptAsync('<img onerror=alert(1)>');
    const dialog = document.querySelector('dialog.takus-dialog');
    const label = dialog.querySelector('.takus-dialog-label');
    expect(label.innerHTML).not.toContain('<img');
    dialog.close('cancel');
    await promise;
  });
});

// ── confirmAsync ─────────────────────────────────────────────────────────

describe('confirmAsync', () => {
  it('creates a dialog with custom confirm label', async () => {
    const promise = confirmAsync('Delete this?', { confirmLabel: 'Delete', destructive: true });
    const dialog = document.querySelector('dialog.takus-dialog');
    expect(dialog).toBeTruthy();

    const confirmBtn = dialog.querySelector('[value="ok"]');
    expect(confirmBtn.textContent).toBe('Delete');

    // Cancel
    dialog.close('cancel');
    expect(await promise).toBe(false);
  });

  it('returns false when cancelled via cancel button', async () => {
    const promise = confirmAsync('Sure?');
    const dialog = document.querySelector('dialog.takus-dialog');
    dialog.querySelector('#takus-dlg-cancel').click();
    expect(await promise).toBe(false);
  });

  it('escapes XSS in message', async () => {
    const promise = confirmAsync('<script>alert(1)</script>');
    const dialog = document.querySelector('dialog.takus-dialog');
    const label = dialog.querySelector('.takus-dialog-label');
    expect(label.innerHTML).not.toContain('<script');
    dialog.close('cancel');
    await promise;
  });

  it('uses default confirmLabel of "Confirm"', async () => {
    const promise = confirmAsync('Continue?');
    const dialog = document.querySelector('dialog.takus-dialog');
    const confirmBtn = dialog.querySelector('[value="ok"]');
    expect(confirmBtn.textContent).toBe('Confirm');
    dialog.close('cancel');
    await promise;
  });
});

// ── selectAsync ──────────────────────────────────────────────────────────

describe('selectAsync', () => {
  it('creates a dialog with a select element and correct options', async () => {
    const promise = selectAsync('Pick', ['a', 'b', 'c'], ['Alpha', 'Beta', 'Charlie'], 'b');
    const dialog = document.querySelector('dialog.takus-dialog');
    expect(dialog).toBeTruthy();

    const select = dialog.querySelector('#takus-dlg-select');
    expect(select).toBeTruthy();
    expect(select.options).toHaveLength(3);
    expect(select.value).toBe('b');

    dialog.close('cancel');
    expect(await promise).toBeNull();
  });

  it('returns null when cancelled', async () => {
    const promise = selectAsync('Pick', ['x'], ['X']);
    const dialog = document.querySelector('dialog.takus-dialog');
    dialog.querySelector('#takus-dlg-cancel').click();
    expect(await promise).toBeNull();
  });

  it('escapes XSS in option labels', async () => {
    const promise = selectAsync('Pick', ['x'], ['<img onerror=alert(1)>']);
    const dialog = document.querySelector('dialog.takus-dialog');
    const option = dialog.querySelector('option');
    expect(option.innerHTML).not.toContain('<img');
    dialog.close('cancel');
    await promise;
  });

  it('pre-selects the currentValue', async () => {
    const promise = selectAsync('Choose', ['a', 'b'], ['A', 'B'], 'b');
    const dialog = document.querySelector('dialog.takus-dialog');
    const select = dialog.querySelector('#takus-dlg-select');
    expect(select.value).toBe('b');
    dialog.close('cancel');
    await promise;
  });
});

// ── promptAreaAsync ──────────────────────────────────────────────────────

describe('promptAreaAsync', () => {
  it('creates a dialog with a <textarea>', async () => {
    const promise = promptAreaAsync('Enter notes', 'Type here…');
    const dialog = document.querySelector('dialog.takus-dialog');
    expect(dialog).toBeTruthy();

    const textarea = dialog.querySelector('#takus-dlg-area');
    expect(textarea).toBeTruthy();
    expect(textarea.placeholder).toBe('Type here…');

    dialog.close('cancel');
    expect(await promise).toBeNull();
  });

  it('escapes XSS in message', async () => {
    const promise = promptAreaAsync('<img onerror=alert(1)>');
    const dialog = document.querySelector('dialog.takus-dialog');
    const label = dialog.querySelector('.takus-dialog-label');
    expect(label.innerHTML).not.toContain('<img');
    dialog.close('cancel');
    await promise;
  });
});
