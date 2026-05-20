// Takus — Keyboard Manager
// Global keyboard shortcuts extracted from app-shell.js

import { icons } from './icons.js';

/**
 * Open the keyboard shortcuts overlay.
 * @param {object} shortcuts - { record, pause, stop } key mapping
 */
export function openShortcutsOverlay(shortcuts) {
  document.getElementById('shortcuts-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'shortcuts-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Keyboard shortcuts');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10001;display:flex;align-items:center;justify-content:center;padding:var(--space-4);backdrop-filter:blur(6px);';

  const fmtKey = (k) => k === ' ' ? 'Space' : k.toUpperCase();
  const row = (label, key) =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-1) 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="font-size:var(--font-xs);color:var(--color-text-secondary);">${label}</span>
      <kbd style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:2px 8px;font-size:11px;font-family:monospace;color:var(--color-text-primary);">${key}</kbd>
    </div>`;

  overlay.innerHTML = `
    <div style="background:var(--color-surface);border:1px solid rgba(255,255,255,0.1);border-radius:var(--radius-lg);padding:var(--space-5);min-width:280px;max-width:380px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,0.6);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);">
        <span style="font-size:var(--font-base);font-weight:var(--weight-semi);color:var(--color-text-primary);">${icons.keyboard(16)} Keyboard Shortcuts</span>
        <button id="sc-close" style="background:none;border:none;cursor:pointer;color:var(--color-text-muted);font-size:18px;line-height:1;padding:4px;" title="Close">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-3);">
        <div>
          <div style="font-size:9px;color:var(--color-text-disabled);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:var(--space-1);">Capture</div>
          ${row('Start recording', fmtKey(shortcuts.record || 'r'))}
          ${row('Pause / Resume', fmtKey(shortcuts.pause || ' '))}
          ${row('Stop recording', fmtKey(shortcuts.stop || 's'))}
        </div>
        <div>
          <div style="font-size:9px;color:var(--color-text-disabled);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:var(--space-1);">Navigation</div>
          ${row('Command Bar', '⌘ K  or  /')}
          ${row('Settings tab', ',')}
          ${row('Close detail view', 'Esc')}
          ${row('Show this help', '?')}
        </div>
      </div>
      <p style="font-size:10px;color:var(--color-text-disabled);text-align:center;margin-top:var(--space-3);">Press <kbd style="background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:3px;">Esc</kbd> or <kbd style="background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:3px;">?</kbd> to close</p>
    </div>`;

  document.body.appendChild(overlay);
  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === '?') close();
  };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  overlay.querySelector('#sc-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
}

/**
 * Install the global keyboard shortcut handler.
 * @param {object} context - { sm, shortcuts, onStart, onPause, onResume, onStop, focusAskInput, openSettings }
 */
export function setupKeyboardShortcuts(context) {
  const { sm, States } = context;

  const handler = (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    if (typeof document.hasFocus === 'function' && !document.hasFocus()) return;

    const shortcuts = context.getShortcuts();
    const key = e.key === ' ' ? ' ' : e.key.toLowerCase();

    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      context.openCommandBar();
    } else if (e.key === '/' && sm.is(States.IDLE)) {
      e.preventDefault();
      context.openCommandBar();
    } else if (e.key === ',' && sm.is(States.IDLE)) {
      e.preventDefault();
      const settingsTab = document.querySelector('.main-tab[data-tab="settings"]');
      if (settingsTab) settingsTab.click();
      else context.openSettings();
    } else if (e.key === '?' && sm.is(States.IDLE)) {
      e.preventDefault();
      openShortcutsOverlay(shortcuts);
    } else if (key === shortcuts.record && sm.is(States.IDLE)) {
      e.preventDefault();
      context.onStart();
    } else if (key === shortcuts.pause && sm.is(States.RECORDING)) {
      e.preventDefault();
      context.onPause();
    } else if (key === shortcuts.pause && sm.is(States.PAUSED)) {
      e.preventDefault();
      context.onResume();
    } else if (key === shortcuts.stop && sm.is(States.RECORDING, States.PAUSED)) {
      e.preventDefault();
      context.onStop();
    } else if (e.key === 'Enter' && sm.is(States.PREVIEWING)) {
      e.preventDefault();
      context.onStart();
    } else if (e.key === 'Escape' && sm.is(States.PREVIEWING, States.REQUESTING_ACCESS)) {
      e.preventDefault();
      context.onStop();
    } else if (e.key === 'Escape' && sm.is(States.IDLE)) {
      const detailSlot = document.getElementById('entry-detail-slot');
      if (detailSlot && detailSlot.style.display !== 'none' && detailSlot.innerHTML) {
        const backBtn = detailSlot.querySelector('#rd-back');
        if (backBtn) { e.preventDefault(); backBtn.click(); }
      }
    }
  };

  document.addEventListener('keydown', handler);

  /** Remove the global keydown listener. */
  return () => document.removeEventListener('keydown', handler);
}
